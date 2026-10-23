import { waitAppGone, waitAppRunning, type LiaraClient } from '../../liara/index.js';
import type { LlmClient } from '../../llm/types.js';
import type { OpsContext } from '../../ops/context.js';
import { deleteApp, deleteDatabase } from '../../ops/delete.js';
import { rollbackApp, type RollbackDeps } from '../../ops/releases.js';
import { runBuildDoctor } from '../../sre/build-doctor.js';
import { runDoctor, type DoctorDeps, type DoctorMode } from '../../sre/doctor.js';
import type { CodeFixRouter } from '../../sre/execute-fix.js';
import { probe, type ProbeOptions } from '../../sre/health.js';
import { actionsFromAudit, createIncident, writeIncidentReport, type Incident, type IncidentReportFiles } from '../../sre/incident.js';
import type { Hypothesis } from '../../sre/rca.js';
import { CANCELLED, type Prompter } from '../../ui/cli/approver.js';
import { toman } from '../../ui/cli/format.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import { classifyFailure, MAX_FIX_ATTEMPTS, MAX_UPLOAD_RETRIES, routeFor, type DeployFailure } from '../failure-policy.js';
import type { PipelineResult } from '../pipeline-engine.js';
import type { SummaryState } from './summary.js';
import { defaultAppUrl } from './verify.js';

/**
 * Deploy-failure decision machine (T5.11). Runs after a deploy/redeploy pipeline failed and follows the
 * table in failure-policy.ts: stop on preflight, offer (≤ 2) upload retries, build analysis (T8.13) with
 * config fixes or the code-fix router, wait/inspect on timeout (never an automatic redeploy), rollback
 * first on a broken redeploy, the SRE cycle otherwise. fix → redeploy is capped at 3 per incident.
 * Every change goes through the gated ops; every failure lands in one `deploy-failure` incident.
 */

export type FailureOutcomeStatus = 'recovered' | 'rolled-back' | 'unknown' | 'stopped' | 'gave-up' | 'cleaned';

export interface FailureOutcome {
  status: FailureOutcomeStatus;
  messageFa: string;
  failures: DeployFailure[];
  /** What was tried, in order (Persian, for the final report). */
  triedFa: string[];
  incident: Incident;
  reportFiles?: IncidentReportFiles;
  /** The last pipeline result (after retries / redeploys). */
  result: PipelineResult<SummaryState>;
}

export interface OnFailureDeps {
  liara: LiaraClient;
  ui: Prompter;
  ops: OpsContext;
  llm?: LlmClient;
  yes?: boolean;
  /** Runs the deploy again (redeploy pipeline, with its own R1 card). */
  redeploy: () => Promise<PipelineResult<SummaryState>>;
  /** Code fixes (T8.15 picks self / handoff / report; default self = T8.9). */
  codeFix?: CodeFixRouter;
  /** SRE cycle settings (snapshot, verify, wait, reportsDir…). */
  doctor?: Omit<DoctorDeps, 'liara' | 'ui' | 'ops' | 'llm' | 'codeFix'>;
  rollback?: Partial<Omit<RollbackDeps, 'ledger' | 'deploy'>>;
  /** "Wait 5 more minutes" (ms, default 5 min) and how the app is checked meanwhile. */
  waitMoreMs?: number;
  wait?: { intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  urlFor?: (app: string) => string | Promise<string>;
  probe?: Pick<ProbeOptions, 'count' | 'timeoutMs' | 'fetchImpl'>;
  /** Where `reports/incidents/` is written (no file when omitted). */
  reportsDir?: string;
  /** Audit dir for the incident's action list. */
  dataDir?: string;
}

const f = fa.onFailure;

function codeHypothesis(): Hypothesis {
  return {
    id: 'build-code',
    titleFa: fa.buildDoctor.cause['typescript-error'] as string,
    category: 'code',
    confidence: 0.85,
    evidence: [],
    explanationFa: fa.buildDoctor.cause['typescript-error'] as string,
    proposedFixes: [{ actionType: 'code_patch', expectedEffectFa: fa.buildDoctor.fix.codePatch }],
    howToVerifyFa: fa.buildDoctor.fix.codePatch,
    source: 'rules',
  };
}

export async function handleDeployFailure(first: PipelineResult<SummaryState>, deps: OnFailureDeps): Promise<FailureOutcome> {
  const { liara, ui } = deps;
  const app = first.state.appName;
  const failures: DeployFailure[] = [];
  const triedFa: string[] = [];
  const counters = { uploadRetries: 0, fixAttempts: 0 };
  const incident = createIncident({ app: app ?? 'unknown', kind: 'deploy-failure', signals: [] });
  // decided once, from the state before anything below changes the ledger
  const isFirstDeploy = !(app && liara.ledger.list(app).some((r) => r.result === 'success' && r.id !== first.state.deployment?.id));
  let result = first;

  const finish = (status: FailureOutcomeStatus, extraFa?: string): FailureOutcome => {
    const last = failures[failures.length - 1];
    incident.severity = failures.some((x) => x.kind === 'runtime') ? 'critical' : 'warn';
    incident.summaryFa = failures.map((x) => f.kind[x.kind] ?? x.kind).join(' → ');
    incident.status = status === 'recovered' || status === 'rolled-back' ? 'resolved' : status === 'gave-up' ? 'gave-up' : 'waiting-fix';
    if (incident.status === 'resolved') incident.closedAt = new Date().toISOString();
    if (deps.dataDir && app) incident.actions = actionsFromAudit(deps.dataDir, app, incident.openedAt);
    const reportFiles = deps.reportsDir ? writeIncidentReport(deps.reportsDir, incident) : undefined;
    const messageFa = [f.result[status] ?? status, ...(extraFa ? [extraFa] : []), ...(last?.messageFa && status === 'stopped' ? [last.messageFa] : [])].join('\n');
    return { status, messageFa, failures, triedFa, incident, ...(reportFiles ? { reportFiles } : {}), result };
  };

  /** "Never mind" after a failed first deploy: keep, or delete everything created (R3 each). */
  const offerCleanup = async (status: FailureOutcomeStatus): Promise<FailureOutcome> => {
    const prov = result.state.provisioned;
    if (!isFirstDeploy || !app || !prov?.app) return finish(status);
    const resources = [prov.app.name, ...(prov.db ? [prov.db.name] : []), ...(prov.disk ? [prov.disk.name] : [])];
    const monthly = result.state.cost?.totalMonthlyToman ?? result.state.planChoice?.monthlyToman ?? 0;
    const daily = toman(Math.round(monthly / 30));
    const pick = deps.yes ? 'keep' : await ui.select(f.cleanupQuestion, [
      { value: 'keep', label: f.keep },
      { value: 'delete', label: f.deleteAll(daily) },
    ]);
    if (pick !== 'delete') {
      ui.note(f.kept, f.title);
      return finish(status);
    }
    const reasonFa = f.cleanupReason(resources.join(', '), daily);
    const gone = await deleteApp({ apps: { deleteApp: (n) => liara.apps.deleteApp(n), waitGone: (n) => waitAppGone(liara.apps, n, deps.wait ?? {}) } }, app, deps.ops, { reasonFa });
    if (gone.status !== 'executed') return finish(status);
    if (prov.db) await deleteDatabase({ dbRemove: (n) => liara.db.removeDb(n) }, prov.db.name, deps.ops, { reasonFa, usedBy: [app] });
    return finish('cleaned');
  };

  const sre = async (mode: DoctorMode): Promise<boolean> => {
    if (!app) return false;
    const r = await runDoctor(app, {
      ...deps.doctor,
      liara,
      ui,
      ops: deps.ops,
      ...(deps.llm ? { llm: deps.llm } : {}),
      ...(deps.codeFix ? { codeFix: deps.codeFix } : {}),
    }, { mode });
    return r.state.verification?.verdict === 'resolved';
  };

  for (;;) {
    if (result.status === 'done') return finish('recovered');
    const failure = classifyFailure({
      failedStep: result.failedStep,
      error: result.error,
      isFirstDeploy,
      ...(app && liara.ledger.previousHealthy(app) ? { previousHealthy: liara.ledger.previousHealthy(app)!.id } : {}),
      attempt: failures.length + 1,
      ...(result.messageFa ? { messageFa: result.messageFa } : {}),
    });
    failures.push(failure);
    const dep = result.state.deployment;
    if (app && dep) liara.ledger.update(app, dep.id, { message: `incident ${incident.id}: ${failure.kind}` });

    const route = routeFor(failure, counters);
    if (route === 'stop') {
      if (failure.kind === 'preflight') {
        ui.note([failure.messageFa ?? f.kind.preflight, f.preflightHint].join('\n'), f.title);
        return finish('stopped');
      }
      if (failure.kind === 'upload') {
        ui.note(f.retriesExhausted, f.title);
        return offerCleanup('stopped');
      }
      ui.note([f.capReached(MAX_FIX_ATTEMPTS), ...triedFa.map((t) => `• ${t}`)].join('\n'), f.title);
      return offerCleanup('gave-up');
    }

    if (route === 'offer-retry') {
      const ok = await ui.select(f.retryQuestion(counters.uploadRetries + 1, MAX_UPLOAD_RETRIES), [
        { value: 'retry', label: f.retry },
        { value: 'no', label: f.notNow },
      ]);
      if (ok !== 'retry') return offerCleanup('stopped');
      counters.uploadRetries++;
      triedFa.push(f.tried.retry);
      result = await deps.redeploy();
      continue;
    }

    if (route === 'build-analysis') {
      counters.fixAttempts++;
      if (!app || !result.state.projectPath) return finish('stopped');
      let redeployed: PipelineResult<SummaryState> | undefined;
      const bd = await runBuildDoctor(
        { lines: failure.tail, projectPath: result.state.projectPath, app },
        {
          ui,
          ...(deps.llm ? { llm: deps.llm } : {}),
          ...(deps.yes ? { yes: true } : {}),
          redeploy: async () => {
            redeployed = await deps.redeploy();
            return { status: redeployed.status, ...(redeployed.messageFa ? { messageFa: redeployed.messageFa } : {}) };
          },
        },
      );
      if (bd.diagnosis.fix.type === 'code_patch') {
        if (!deps.codeFix) {
          ui.note(f.noCodeFix, f.title);
          return offerCleanup('stopped');
        }
        triedFa.push(f.tried.codeFix);
        const r = await deps.codeFix.fix({ app, hypothesis: codeHypothesis(), error: failure.tail.join('\n'), incidentId: incident.id });
        if (r.status === 'deployed') return finish('recovered');
        if (r.messageFa) ui.note(r.messageFa, f.title);
        return offerCleanup('stopped');
      }
      if (!bd.applied || !redeployed) return offerCleanup('stopped');
      triedFa.push(f.tried.buildFix(bd.diagnosis.fix.descriptionFa));
      result = redeployed;
      continue;
    }

    if (route === 'wait-or-inspect') {
      ui.note(f.timeoutUnknown, f.title);
      for (;;) {
        const waitMs = deps.waitMoreMs ?? 5 * 60_000;
        const pick = await ui.select(f.timeoutQuestion, [
          { value: 'wait', label: f.waitMore(Math.round(waitMs / 60_000)) },
          { value: 'inspect', label: f.inspect },
          { value: 'leave', label: f.leave },
        ]);
        if (pick === 'wait' && app) {
          const url = await (deps.urlFor ?? defaultAppUrl)(app);
          const up = await waitAppRunning(liara.apps, app, {
            timeoutMs: waitMs,
            ...deps.wait,
            probe: async () => ((await probe(url, { paths: ['/'], count: 1, timeoutMs: 10_000, ...deps.probe })).availability ?? 0) > 0,
          }).then(
            () => true,
            () => false,
          );
          if (up) {
            if (dep) liara.ledger.update(app, dep.id, { result: 'success' });
            ui.note(f.cameUp, f.title);
            return finish('recovered');
          }
          ui.note(f.stillPending, f.title);
          continue;
        }
        if (pick === 'inspect') await sre('diagnose');
        return finish('unknown');
      }
    }

    if (route === 'rollback-first') {
      const pick = await ui.select(f.rollbackQuestion, [
        { value: 'rollback', label: f.rollbackYes },
        { value: 'sre', label: f.rollbackNo },
      ]);
      if (pick === 'rollback' && app) {
        triedFa.push(f.tried.rollback);
        const rb = await rollbackApp({ ledger: liara.ledger, deploy: liara.deploy, ...deps.rollback }, app, deps.ops, {
          ...(failure.previousHealthy ? { targetId: failure.previousHealthy } : {}),
          reasonFa: f.rollbackReason,
        });
        if (rb.status === 'executed') {
          ui.note(f.rolledBack, f.title);
          // the broken release is still worth a diagnosis; nothing is changed in this mode
          await sre('diagnose');
          return finish('rolled-back');
        }
      }
      if (pick === CANCELLED) return finish('stopped');
    }

    // 'sre' (first deploy crash, or the user declined the rollback)
    counters.fixAttempts++;
    triedFa.push(f.tried.sre);
    if (await sre('full')) return finish('recovered');
    return offerCleanup(counters.fixAttempts >= MAX_FIX_ATTEMPTS ? 'gave-up' : 'stopped');
  }
}
