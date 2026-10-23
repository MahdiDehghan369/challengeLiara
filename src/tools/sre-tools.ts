import { z } from 'zod';
import { newPlanId } from '../ops/context.js';
import { Risk } from '../safety/risk.js';
import { buildProbeCommand, PROBE_IDS, runContainerChecks } from '../sre/container-probes.js';
import { runDetectors, type Signal } from '../sre/detectors/index.js';
import { healthScore, type HealthScore } from '../sre/health-score.js';
import { takeSnapshot, type SnapshotDeps } from '../sre/snapshot.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolDefinition } from './types.js';

/** SRE tools (T7.6). `health_check` (R0): snapshot → detectors → score. */

export type SreToolsOptions = Omit<SnapshotDeps, 'liara'> & { defaultWindowSec?: number };

export interface HealthCheckResult extends HealthScore {
  app: string;
  signals: Signal[];
  failedSources: string[];
  takenAt: string;
}

export function sreTools(opts: SreToolsOptions = {}): ToolDefinition[] {
  const { defaultWindowSec, ...snapshotOpts } = opts;
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
  return tools as ToolDefinition[];
}
