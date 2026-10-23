import { resolve } from 'node:path';
import { readProjectState } from '../agent/project-state.js';
import { analyzeProject } from '../analyzer/report.js';
import type { Config } from '../config/env.js';
import type { LiaraClient } from '../liara/index.js';
import type { OpsContext } from '../ops/context.js';
import type { ApprovalDecision, Approver } from '../safety/approval.js';
import { ValidationError } from '../shared/errors.js';
import type { ProbeOptions } from '../sre/health.js';
import type { Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { RunOptions } from './pipeline.js';
import { runPipeline, type Pipeline, type PipelineResult, type Step } from './pipeline-engine.js';
import { deployStep } from './steps/deploy.js';
import { preflightStep } from './steps/preflight.js';
import { summaryStep, type SummaryState } from './steps/summary.js';
import { verifyStep, type VerifyResult } from './steps/verify.js';

/** `redeploy_app` (T5.10, R1): a new version of the current code — preflight → deploy → verify → summary. */

export const REDEPLOY_PIPELINE_ID = 'redeploy';

/**
 * Approves exactly one already-approved action (same tool, same app) — used when the registry already
 * showed the `redeploy_app` card, so the inner `deploy_app` is not asked twice. Everything else → `base`.
 */
export function preApprovedApprover(base: Approver, toolName: string, app: string): Approver {
  return {
    request: async (plan, ctx): Promise<ApprovalDecision> =>
      plan.toolName === toolName && plan.target.app === app ? 'approved' : base.request(plan, ctx),
  };
}

export function loadProjectStep<S extends SummaryState>(projectPath: string, app?: string): Step<S> {
  return {
    id: 'load-project',
    titleFa: fa.redeploy.loadTitle,
    run: async (ctx) => {
      const path = resolve(projectPath);
      const name = app ?? readProjectState(path)?.app;
      if (!name) throw new ValidationError('no app recorded for this project', { messageFa: fa.redeploy.noApp });
      ctx.state.projectPath = path;
      ctx.state.appName = name;
      ctx.state.redeploy = true;
      ctx.state.report = await analyzeProject(path, { useLlm: false });
    },
  };
}

export interface RedeployDeps {
  config: Pick<Config, 'liara' | 'deployMode'>;
  liara: LiaraClient;
  ui: Prompter;
  ops: OpsContext;
  app?: string;
  /** The registry already approved `redeploy_app` for this app. */
  preApproved?: boolean;
  verbose?: boolean;
  onLine?: (line: string) => void;
  urlFor?: (app: string) => string | Promise<string>;
  probe?: Pick<ProbeOptions, 'count' | 'timeoutMs' | 'fetchImpl'>;
  wait?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  observeMs?: number;
  onUnhealthy?: (result: VerifyResult) => Promise<void> | void;
}

export function buildRedeployPipeline(projectPath: string, deps: RedeployDeps): Pipeline<SummaryState> {
  const app = deps.app ?? readProjectState(resolve(projectPath))?.app;
  const ops: OpsContext = deps.preApproved && app ? { ...deps.ops, approver: preApprovedApprover(deps.ops.approver, 'deploy_app', app) } : deps.ops;
  return {
    id: REDEPLOY_PIPELINE_ID,
    steps: [
      preflightStep({ liara: deps.liara, config: deps.config, projectPath, needCli: deps.config.deployMode === 'cli' }),
      loadProjectStep(projectPath, deps.app),
      deployStep({
        liara: deps.liara,
        ui: deps.ui,
        ops,
        mode: deps.config.deployMode,
        ...(deps.verbose ? { verbose: true } : {}),
        ...(deps.onLine ? { onLine: deps.onLine } : {}),
        ...(deps.wait ? { wait: deps.wait } : {}),
      }),
      verifyStep({
        liara: deps.liara,
        ui: deps.ui,
        ...(deps.urlFor ? { urlFor: deps.urlFor } : {}),
        ...(deps.probe ? { probe: deps.probe } : {}),
        ...(deps.wait ? { wait: deps.wait } : {}),
        ...(deps.observeMs !== undefined ? { observeMs: deps.observeMs } : {}),
        ...(deps.onUnhealthy ? { onUnhealthy: deps.onUnhealthy } : {}),
      }),
      summaryStep({ liara: deps.liara, ui: deps.ui, deployMode: deps.config.deployMode }),
    ],
  };
}

export function runRedeploy(projectPath: string, deps: RedeployDeps, run: RunOptions = {}): Promise<PipelineResult<SummaryState>> {
  return runPipeline(buildRedeployPipeline(projectPath, deps), {
    state: {},
    ...(run.session ? { session: run.session } : {}),
    ...(run.resume ? { resume: true } : {}),
    ...(run.signal ? { signal: run.signal } : {}),
    ...(run.onEvent ? { onEvent: run.onEvent } : {}),
  });
}
