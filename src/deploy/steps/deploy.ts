import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import type { DeployStage, LiaraClient, ReleaseSignal } from '../../liara/index.js';
import { guardOptions, newPlanId, type OpsContext } from '../../ops/context.js';
import { guard } from '../../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../../safety/risk.js';
import { ExternalCommandError, ValidationError } from '../../shared/errors.js';
import type { Prompter } from '../../ui/cli/approver.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Step } from '../pipeline-engine.js';
import { deployEventsSignal, deployViaApi } from '../strategies/api.js';
import { deployViaCli, type DeployProgress, type StrategyResult } from '../strategies/cli.js';
import type { ConfigureState } from './configure.js';
import { deployPlanApprover } from './provision.js';

/**
 * Deploy (T5.7): API or CLI strategy with live stages/percent (raw lines only with `--verbose`), a
 * ledger record before and after, and `deploy_app` (R1) through the gate — pre-approved for a new app by
 * the deploy-plan card (T5.4), its own card on redeploy. On failure: last 30 log lines + a short message;
 * the error carries `tail`/`evidence` for the deploy-failure decision machine (T5.11, on-failure.ts).
 */

export const FAILURE_TAIL_LINES = 30;

export interface DeployStepState extends ConfigureState {
  deployment?: {
    id: string;
    mode: 'api' | 'cli';
    result: StrategyResult['result'];
    version?: string;
    releaseID?: string;
    sourceID?: string;
  };
}

export interface DeployStepDeps {
  liara: Pick<LiaraClient, 'deploy' | 'cli' | 'events' | 'logs' | 'ledger'>;
  ui: Prompter;
  ops: OpsContext;
  mode: 'api' | 'cli';
  verbose?: boolean;
  /** Print raw lines (verbose mode); defaults to nothing. */
  onLine?: (line: string) => void;
  /** API mode: release signals (default: interim deploy events, OQ-15) and wait tuning. */
  signals?: ReleaseSignal[];
  wait?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  /** CLI mode timeout. */
  cliTimeoutMs?: number;
  now?: () => number;
}

async function gitInfo(path: string): Promise<{ commit?: string; dirty: boolean }> {
  if (!existsSync(join(path, '.git'))) return { dirty: false };
  try {
    const git = simpleGit(path);
    const [commit, status] = await Promise.all([git.revparse(['HEAD']), git.status()]);
    return { commit: commit.trim(), dirty: status.files.length > 0 };
  } catch {
    return { dirty: false };
  }
}

export function deployStep<S extends DeployStepState>(deps: DeployStepDeps): Step<S> {
  const d = fa.deployStep;
  const now = deps.now ?? Date.now;
  return {
    id: 'deploy',
    titleFa: d.title,
    onFail: 'diagnose',
    run: async (ctx) => {
      const s = ctx.state;
      const report = s.report;
      const app = s.appName;
      const path = s.projectPath;
      if (!report || !app || !path) throw new Error('deploy needs the analyze step first');
      const platform = report.platform.liaraPlatformId;
      if (deps.mode === 'api' && !platform) throw new ValidationError('no confirmed platform id', { messageFa: d.noPlatform });

      // pre-approved by the deploy-plan card for a new app; a redeploy gets its own R1 card
      const approver =
        s.deployApproval && s.planChoice ? deployPlanApprover(deps.ops.approver, { app, planId: s.planChoice.planId, disk: false }) : deps.ops.approver;
      const ctxOps: OpsContext = { ...deps.ops, approver };
      const plan: ActionPlan = escalate(
        {
          id: newPlanId('deploy'),
          toolName: 'deploy_app',
          titleFa: d.approveTitle(app),
          reasonFa: d.approveReason,
          target: { app },
          risk: Risk.R1,
          impactFa: d.approveImpact(deps.mode),
          rollbackFa: d.approveRollback,
          command:
            deps.mode === 'cli'
              ? `liara deploy --app ${app} --path . --port ${report.port.port}${platform ? ` --platform ${platform}` : ''}`
              : `POST /v2/projects/${app}/sources + POST /v2/projects/${app}/releases`,
          params: { app, mode: deps.mode, port: report.port.port },
        },
        deps.ops.risk ?? {},
      );

      const git = await gitInfo(path);
      let lastPctNote = -1;
      const progress: DeployProgress & { archiving(): void; waiting(): void } = {
        stage: (st: DeployStage) => ctx.setStatus('running', d.stage[st] ?? st),
        percent: (p) => {
          // a note per quarter, not per byte
          const bucket = Math.floor(p / 25) * 25;
          if (bucket !== lastPctNote) {
            lastPctNote = bucket;
            ctx.setStatus('running', d.uploadPercent(bucket));
          }
        },
        line: (l) => {
          if (deps.verbose) deps.onLine?.(l);
        },
        archiving: () => ctx.setStatus('running', d.archiving),
        waiting: () => ctx.setStatus('running', d.waitingRelease),
      };

      const res = await guard(
        plan,
        approver,
        async () => {
          const rec = deps.liara.ledger.record({
            app,
            mode: deps.mode,
            port: report.port.port,
            ...(platform ? { platform } : {}),
            ...(git.commit ? { gitCommit: git.commit } : {}),
            gitDirty: git.dirty,
          });
          const started = now();
          let out: StrategyResult;
          try {
            out =
              deps.mode === 'cli'
                ? await deployViaCli(
                    deps.liara.cli,
                    {
                      cwd: path,
                      app,
                      port: report.port.port,
                      ...(platform ? { platform } : {}),
                      ...(deps.cliTimeoutMs ? { timeoutMs: deps.cliTimeoutMs } : {}),
                      ...(ctx.signal ? { signal: ctx.signal } : {}),
                    },
                    progress,
                  )
                : await deployViaApi(
                    deps.liara.deploy,
                    {
                      projectPath: path,
                      app,
                      port: report.port.port,
                      platform: platform as string,
                      signals: deps.signals ?? [deployEventsSignal(deps.liara.events, started)],
                      ...(deps.wait ? { wait: deps.wait } : {}),
                    },
                    progress,
                    deps.liara.logs,
                  );
          } catch (e) {
            deps.liara.ledger.update(app, rec.id, { result: 'failed' });
            throw e;
          }
          deps.liara.ledger.update(app, rec.id, {
            result: out.result,
            ...(out.version ? { version: out.version } : {}),
            ...(out.releaseID ? { releaseID: out.releaseID } : {}),
            ...(out.sourceID ? { sourceID: out.sourceID } : {}),
            ...(out.archiveSha256 ? { archiveSha256: out.archiveSha256 } : {}),
          });
          s.deployment = {
            id: rec.id,
            mode: deps.mode,
            result: out.result,
            ...(out.version ? { version: out.version } : {}),
            ...(out.releaseID ? { releaseID: out.releaseID } : {}),
            ...(out.sourceID ? { sourceID: out.sourceID } : {}),
          };
          if (out.result !== 'success') {
            // thrown inside the gate so the audit log records the deploy as failed
            const tail = out.tail.slice(-FAILURE_TAIL_LINES);
            if (tail.length > 0) deps.ui.note(tail.join('\n'), d.tailTitle);
            throw new ExternalCommandError(`deploy ${out.result}`, {
              messageFa: out.result === 'timeout' ? d.timeout : d.failed,
              details: { app, deploymentId: rec.id, evidence: out.evidence, tail },
              retryable: out.result === 'timeout',
            });
          }
          return out;
        },
        guardOptions(ctxOps),
      );
      if (res.status !== 'executed') throw new Error(`deploy not executed (${res.status})`);
      ctx.setStatus('running', d.succeeded(res.result.version));
    },
  };
}
