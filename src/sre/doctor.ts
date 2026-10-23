import type { Session } from '../agent/session.js';
import { runPipeline, type PipelineEvent, type PipelineResult, type Step } from '../deploy/pipeline-engine.js';
import type { LiaraClient } from '../liara/index.js';
import type { LlmClient } from '../llm/types.js';
import type { OpsContext } from '../ops/context.js';
import type { PlanCatalog, PlanEntry } from '../planner/plans.js';
import { CANCELLED, type Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { runDetectors, type Signal } from './detectors/index.js';
import { executeRemediation, type CodeFixRouter, type ExecuteResult } from './execute-fix.js';
import { actionsFromAudit, createIncident, writeIncidentReport, type Incident, type IncidentReportFiles } from './incident.js';
import { analyzeLogs, type LogAnalysis } from './log-analyzer.js';
import { runRca, type Hypothesis, type RcaResult } from './rca.js';
import { planRemediation, type RemediationOption, type RemediationPlan } from './remediate.js';
import { takeSnapshot, type Snapshot, type SnapshotDeps } from './snapshot.js';
import { MAX_FIX_ROUNDS, verifyFix, type VerifyFixOptions, type VerifyFixResult } from './verify.js';

/**
 * SRE cycle (T8.12) on the pipeline engine (T5.1): collect → detect → analyze logs → RCA → present →
 * choose → execute (gated) → verify (next hypothesis on "unchanged", ≤ 3 rounds) → incident report.
 * `diagnose` mode stops after presenting the findings (R0, nothing changes).
 */

export type DoctorMode = 'diagnose' | 'full';

export interface DoctorRound {
  hypothesisId: string;
  tool: string;
  execution: ExecuteResult['status'];
  verdict?: VerifyFixResult['verdict'];
}

export interface DoctorState {
  [key: string]: unknown;
  app: string;
  userDescription?: string;
  snapshot?: Snapshot;
  signals?: Signal[];
  logs?: LogAnalysis;
  rca?: RcaResult;
  remediation?: RemediationPlan;
  rounds?: DoctorRound[];
  verification?: VerifyFixResult;
  incident?: Incident;
  reportFiles?: IncidentReportFiles;
  healthy?: boolean;
}

export interface DoctorDeps {
  liara: LiaraClient;
  ui: Prompter;
  ops: OpsContext;
  llm?: LlmClient;
  catalog?: PlanCatalog;
  /** Snapshot extras: urlFor, probe, units (OQ-3), dataDir (audit). */
  snapshot?: Omit<SnapshotDeps, 'liara' | 'catalog'>;
  codeFix?: CodeFixRouter;
  verify?: Omit<VerifyFixOptions, 'round' | 'fixedAt'>;
  wait?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  /** Where `reports/incidents/` is written (no file when omitted). */
  reportsDir?: string;
  windowSec?: number;
}

const d = fa.doctor;

function snapshotDeps(deps: DoctorDeps): SnapshotDeps {
  return { ...deps.snapshot, liara: deps.liara, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
}

/** Error text for a code fix: the full log record behind the hypothesis' first log evidence. */
export function errorTextFor(h: Hypothesis, rca: RcaResult, logs: LogAnalysis | undefined): string {
  const ref = h.evidence.find((e) => e.type === 'log');
  const item = ref ? rca.catalog.find((c) => c.ref === ref.ref) : undefined;
  const finding = item ? logs?.findings.find((f) => f.sample.includes(item.text.split('\n')[0] ?? '')) : undefined;
  return finding?.sample ?? item?.text ?? h.titleFa;
}

export function formatFindings(rca: RcaResult, plan: RemediationPlan, signals: Signal[]): string {
  const top = rca.hypotheses[0];
  const problem = signals[0]?.titleFa ?? top?.titleFa ?? '—';
  return [
    d.problem(problem),
    ...(top ? [d.cause(top.titleFa, Math.round(top.confidence * 100)), d.evidence(top.evidence.map((e) => e.quote).slice(0, 3).join(' | ') || '—')] : []),
    d.quick(plan.quickFix?.titleFa ?? d.noFix),
    d.root(plan.rootFix?.titleFa ?? d.noFix),
  ].join('\n');
}

async function currentPlanInfo(deps: DoctorDeps, s: DoctorState): Promise<{ currentPlan?: PlanEntry; plans?: PlanEntry[] }> {
  const appInfo = s.snapshot?.sources.app.ok ? s.snapshot.sources.app.value : undefined;
  if (!deps.catalog || !appInfo?.planID) return {};
  const plans = await deps.catalog.list().catch(() => undefined);
  const currentPlan = plans?.find((p) => p.id === appInfo.planID);
  return { ...(currentPlan ? { currentPlan } : {}), ...(plans ? { plans } : {}) };
}

export function doctorSteps(deps: DoctorDeps, mode: DoctorMode): Array<Step<DoctorState>> {
  const st = d.steps;
  const steps: Array<Step<DoctorState>> = [
    {
      id: 'collect',
      titleFa: st.collect!,
      run: async (ctx) => {
        ctx.state.snapshot = await takeSnapshot(ctx.state.app, deps.windowSec ?? 900, snapshotDeps(deps));
      },
    },
    {
      id: 'detect',
      titleFa: st.detect!,
      run: async (ctx) => {
        const signals = runDetectors(ctx.state.snapshot as Snapshot);
        ctx.state.signals = signals;
        ctx.state.healthy = !signals.some((s) => s.severity !== 'info');
        if (ctx.state.healthy) deps.ui.note(d.healthy(ctx.state.app), d.findingsTitle(ctx.state.app));
      },
    },
    {
      id: 'analyze',
      titleFa: st.analyze!,
      skipIf: (ctx) => ctx.state.healthy === true,
      run: async (ctx) => {
        const snap = ctx.state.snapshot as Snapshot;
        const platform = snap.sources.app.ok ? snap.sources.app.value.platform : undefined;
        ctx.state.logs = await analyzeLogs(snap.sources.logs.ok ? snap.sources.logs.value : [], {
          ...(deps.llm ? { llm: deps.llm } : {}),
          ...(platform ? { platform } : {}),
        });
      },
    },
    {
      id: 'rca',
      titleFa: st.rca!,
      skipIf: (ctx) => ctx.state.healthy === true,
      run: async (ctx) => {
        const s = ctx.state;
        s.rca = await runRca(
          { snapshot: s.snapshot as Snapshot, signals: s.signals ?? [], logs: s.logs as LogAnalysis, ...(s.userDescription ? { userDescription: s.userDescription } : {}) },
          { ...(deps.llm ? { llm: deps.llm } : {}), app: s.app },
        );
      },
    },
    {
      id: 'present',
      titleFa: st.present!,
      skipIf: (ctx) => ctx.state.healthy === true,
      run: async (ctx) => {
        const s = ctx.state;
        s.remediation = planRemediation(s.rca as RcaResult, { app: s.app, hasHealthyPrevious: !!deps.liara.ledger.previousHealthy(s.app), ...(await currentPlanInfo(deps, s)) });
        deps.ui.note(formatFindings(s.rca as RcaResult, s.remediation, s.signals ?? []), d.findingsTitle(s.app));
      },
    },
  ];
  if (mode === 'diagnose') return steps;

  steps.push(
    {
      id: 'fix',
      titleFa: st.fix!,
      skipIf: (ctx) => ctx.state.healthy === true,
      run: async (ctx) => {
        const s = ctx.state;
        const rca = s.rca as RcaResult;
        const incidentId = (s.incident ??= createIncident({ app: s.app, kind: 'runtime', signals: s.signals ?? [], hypotheses: rca.hypotheses })).id;
        s.rounds ??= [];
        const info = await currentPlanInfo(deps, s);
        for (let round = 1; round <= Math.min(MAX_FIX_ROUNDS, rca.hypotheses.length); round++) {
          const h = rca.hypotheses[round - 1] as Hypothesis;
          // plan for this hypothesis first (the others stay as fallbacks)
          const plan = planRemediation({ hypotheses: [h, ...rca.hypotheses.filter((x) => x.id !== h.id)] }, { app: s.app, hasHealthyPrevious: !!deps.liara.ledger.previousHealthy(s.app), ...info });
          if (round === 1) s.remediation = plan;
          const choices: Array<{ value: string; label: string; option: RemediationOption }> = [];
          if (plan.rootFix) choices.push({ value: 'root', label: d.chooseRoot(plan.rootFix.titleFa), option: plan.rootFix });
          if (plan.quickFix) choices.push({ value: 'quick', label: d.chooseQuick(plan.quickFix.titleFa), option: plan.quickFix });
          const picked = await deps.ui.select(d.choose, [...choices.map(({ value, label }) => ({ value, label })), { value: 'skip', label: d.chooseSkip }]);
          const choice = picked === CANCELLED ? undefined : choices.find((c) => c.value === picked);
          if (!choice) {
            deps.ui.note(d.skipped, d.findingsTitle(s.app));
            return;
          }
          const fixedAt = Date.now();
          const exec = await executeRemediation(choice.option, h, { liara: deps.liara, ui: deps.ui, ops: deps.ops, ...(deps.catalog ? { catalog: deps.catalog } : {}), ...(deps.codeFix ? { codeFix: deps.codeFix } : {}), ...(deps.wait ? { wait: deps.wait } : {}) }, {
            app: s.app,
            error: errorTextFor(h, rca, s.logs),
            incidentId,
          });
          const r: DoctorRound = { hypothesisId: h.id, tool: choice.option.tool, execution: exec.status };
          s.rounds.push(r);
          if (exec.status !== 'executed') return;
          const v = await verifyFix(s.app, s.snapshot as Snapshot, h, snapshotDeps(deps), { ...deps.verify, fixedAt, round });
          r.verdict = v.verdict;
          s.verification = v;
          deps.ui.note([d.roundTitle(round, v.verdictFa), v.nextFa].join('\n'), d.findingsTitle(s.app));
          if (v.next !== 'next-hypothesis') return;
        }
      },
    },
    {
      id: 'report',
      titleFa: st.report!,
      skipIf: (ctx) => ctx.state.healthy === true,
      run: async (ctx) => {
        const s = ctx.state;
        const incident = (s.incident ??= createIncident({ app: s.app, kind: 'runtime', signals: s.signals ?? [], hypotheses: s.rca?.hypotheses ?? [] }));
        const v = s.verification;
        incident.status = v?.verdict === 'resolved' ? 'resolved' : v && v.next === 'give-up' ? 'gave-up' : 'waiting-fix';
        if (incident.status === 'resolved') incident.closedAt = new Date().toISOString();
        if (v) incident.verification = { verdict: v.verdict, verdictFa: v.verdictFa, table: v.table };
        if (deps.snapshot?.dataDir) incident.actions = actionsFromAudit(deps.snapshot.dataDir, s.app, incident.openedAt);
        if (deps.reportsDir) s.reportFiles = writeIncidentReport(deps.reportsDir, incident);
      },
    },
  );
  return steps;
}

export interface DoctorRunOptions {
  mode?: DoctorMode;
  userDescription?: string;
  session?: Session;
  onEvent?: (e: PipelineEvent) => void;
}

export function runDoctor(app: string, deps: DoctorDeps, opts: DoctorRunOptions = {}): Promise<PipelineResult<DoctorState>> {
  return runPipeline(
    { id: `doctor:${app}`, steps: doctorSteps(deps, opts.mode ?? 'full') },
    {
      state: { app, ...(opts.userDescription ? { userDescription: opts.userDescription } : {}) },
      ...(opts.session ? { session: opts.session, persist: false } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    },
  );
}
