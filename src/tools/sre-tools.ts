import { z } from 'zod';
import { newPlanId } from '../ops/context.js';
import { Risk } from '../safety/risk.js';
import { buildProbeCommand, PROBE_IDS, runContainerChecks } from '../sre/container-probes.js';
import { runPipeline } from '../deploy/pipeline-engine.js';
import { doctorSteps, runDoctor, type DoctorDeps, type DoctorState } from '../sre/doctor.js';
import { ValidationError } from '../shared/errors.js';
import type { Prompter } from '../ui/cli/approver.js';
import type { ToolContext } from './types.js';
import { runDetectors, type Signal } from '../sre/detectors/index.js';
import { healthScore, type HealthScore } from '../sre/health-score.js';
import { takeSnapshot, type SnapshotDeps } from '../sre/snapshot.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolDefinition } from './types.js';

/** SRE tools (T7.6). `health_check` (R0): snapshot → detectors → score. */

export type SreToolsOptions = Omit<SnapshotDeps, 'liara'> & {
  defaultWindowSec?: number;
  /** Enables `diagnose_app` / `fix_issue` (T8.12). */
  doctor?: Omit<DoctorDeps, 'liara' | 'ops' | 'llm'>;
};

/** Answers the doctor's "which fix" question with the tool argument; everything else goes to the real UI. */
export function withChoice(ui: Prompter, choice: 'quick' | 'root'): Prompter {
  return {
    note: (b, t) => ui.note(b, t),
    text: (m, o) => ui.text(m, o),
    ...(ui.password ? { password: (m: string) => ui.password!(m) } : {}),
    select: async (message, options) => (message === fa.doctor.choose ? ((options.find((o) => o.value === choice)?.value ?? 'skip') as never) : ui.select(message, options)),
  };
}

export interface HealthCheckResult extends HealthScore {
  app: string;
  signals: Signal[];
  failedSources: string[];
  takenAt: string;
}

export function sreTools(opts: SreToolsOptions = {}): ToolDefinition[] {
  const { defaultWindowSec, doctor, ...snapshotOpts } = opts;
  const diagnoses = new Map<string, DoctorState>();
  const doctorDeps = (ctx: ToolContext, ui: Prompter): DoctorDeps => ({
    ...(doctor as NonNullable<typeof doctor>),
    ui,
    liara: ctx.liara,
    ops: ctx,
    ...(ctx.llm ? { llm: ctx.llm } : {}),
    snapshot: { ...snapshotOpts, ...doctor?.snapshot },
  });
  const summarizeDoctor = (s: DoctorState) => ({
    app: s.app,
    healthy: s.healthy,
    signals: s.signals?.map((x) => ({ id: x.id, severity: x.severity, detail: x.detail })),
    hypotheses: s.rca?.hypotheses.map((h) => ({ id: h.id, titleFa: h.titleFa, category: h.category, confidence: h.confidence, evidence: h.evidence })),
    quickFix: s.remediation?.quickFix && { tool: s.remediation.quickFix.tool, titleFa: s.remediation.quickFix.titleFa, risk: s.remediation.quickFix.risk },
    rootFix: s.remediation?.rootFix && { tool: s.remediation.rootFix.tool, titleFa: s.remediation.rootFix.titleFa, risk: s.remediation.rootFix.risk },
    rounds: s.rounds,
    verdict: s.verification?.verdict,
    incident: s.incident && { id: s.incident.id, status: s.incident.status },
  });
  const tools = [
    defineTool({
      name: 'health_check',
      descriptionFa: fa.healthScore.toolDescription,
      descriptionEn:
        'Health check of an app: collects status, events, metrics, logs, probe and disks, runs deterministic detectors and returns a 0-100 score, label and signals with evidence.',
      inputSchema: z.object({
        app: z.string().min(1).describe('Liara app name'),
        windowSec: z.number().int().min(60).max(86_400).optional().describe('Look-back window in seconds (default 900)'),
      }),
      risk: Risk.R0,
      handler: async (a, ctx): Promise<HealthCheckResult> => {
        const snap = await takeSnapshot(a.app, a.windowSec ?? defaultWindowSec ?? 900, { ...snapshotOpts, liara: ctx.liara });
        const signals = runDetectors(snap);
        return { app: a.app, ...healthScore(a.app, signals, { failedSources: snap.failed }), signals, failedSources: snap.failed, takenAt: snap.takenAt };
      },
      summarizeForLlm: (r: HealthCheckResult) => ({
        app: r.app,
        score: r.score,
        label: r.label,
        summaryFa: r.summaryFa,
        failedSources: r.failedSources,
        signals: r.signals.map((s) => ({ id: s.id, severity: s.severity, detail: s.detail, evidence: s.evidence })),
      }),
    }),
    defineTool({
      name: 'container_check',
      descriptionFa: fa.containerProbes.toolDescription,
      descriptionEn:
        'Run predefined read-only checks inside the app container to confirm a hypothesis. Only these check ids exist: env-names (variable names only), disk, memory, processes, node-version, list-dir {path}, package-json, dns {host}, tcp {host, port}. Free-form commands are impossible.',
      inputSchema: z.object({
        app: z.string().min(1),
        checks: z
          .array(
            z.object({
              id: z.enum(PROBE_IDS),
              args: z.object({ path: z.string().optional(), host: z.string().optional(), port: z.number().int().optional() }).optional(),
            }),
          )
          .min(1)
          .max(8),
      }),
      risk: Risk.R1,
      buildPlan: async (a) => {
        // validates every check (throws for anything outside the allowlist) before the card is shown
        const commands = a.checks.map((c) => buildProbeCommand(c));
        return {
          id: newPlanId('container_check'),
          toolName: 'container_check',
          titleFa: fa.containerProbes.title(a.app, commands.length),
          reasonFa: fa.containerProbes.reason,
          target: { app: a.app },
          risk: Risk.R1,
          impactFa: fa.containerProbes.impact,
          rollbackFa: fa.containerProbes.rollback,
          command: commands.map((c) => `$ ${c}`).join('\n'),
          params: { app: a.app, checks: a.checks },
        };
      },
      handler: async (a, ctx) => runContainerChecks(ctx.liara.console, a.app, a.checks),
    }),
  ];
  if (doctor) {
    tools.push(
      defineTool({
        name: 'diagnose_app',
        descriptionFa: fa.doctor.diagnoseTool,
        descriptionEn:
          'Full SRE diagnosis without changing anything: snapshot, detectors, log analysis, root-cause hypotheses with evidence, and a quick fix and a root fix proposal. Optionally pass the user\'s own description.',
        inputSchema: z.object({ app: z.string().min(1), description: z.string().max(2000).optional() }),
        risk: Risk.R0,
        handler: async (a, ctx) => {
          const r = await runDoctor(a.app, doctorDeps(ctx, doctor.ui), { mode: 'diagnose', ...(a.description ? { userDescription: a.description } : {}) });
          diagnoses.set(a.app, r.state);
          return r.state;
        },
        summarizeForLlm: summarizeDoctor,
      }) as unknown as (typeof tools)[number],
      defineTool({
        name: 'fix_issue',
        descriptionFa: fa.doctor.fixTool,
        descriptionEn: 'Execute the quick or root fix from the last diagnose_app of this app (each change asks for its own approval), then verify and write the incident report.',
        inputSchema: z.object({ app: z.string().min(1), choice: z.enum(['quick', 'root']) }),
        risk: Risk.R1,
        buildPlan: async (a) => ({
          id: newPlanId('fix_issue'),
          toolName: 'fix_issue',
          titleFa: fa.doctor.fixTool,
          reasonFa: fa.tools.defaultReason,
          target: { app: a.app },
          risk: Risk.R1,
          impactFa: fa.doctor.fixTool,
          rollbackFa: fa.verifyFix.nextUndo,
          command: `fix_issue ${a.app} ${a.choice}`,
          params: { app: a.app, choice: a.choice },
        }),
        handler: async (a, ctx) => {
          const last = diagnoses.get(a.app);
          if (!last || !last.rca) throw new ValidationError('no diagnosis', { messageFa: fa.doctor.noDiagnosis });
          const deps = doctorDeps(ctx, withChoice(doctor.ui, a.choice));
          const steps = doctorSteps(deps, 'full').filter((s) => s.id === 'fix' || s.id === 'report');
          const r = await runPipeline({ id: `doctor-fix:${a.app}`, steps }, { state: { ...last } });
          diagnoses.set(a.app, r.state);
          return r.state;
        },
        summarizeForLlm: summarizeDoctor,
      }) as unknown as (typeof tools)[number],
    );
  }
  return tools as ToolDefinition[];
}
