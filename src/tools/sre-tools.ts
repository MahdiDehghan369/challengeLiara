import { z } from 'zod';
import { Risk } from '../safety/risk.js';
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
      summarizeForLlm: (r) => ({
        app: r.app,
        score: r.score,
        label: r.label,
        summaryFa: r.summaryFa,
        failedSources: r.failedSources,
        signals: r.signals.map((s) => ({ id: s.id, severity: s.severity, detail: s.detail, evidence: s.evidence })),
      }),
    }),
  ];
  return tools as ToolDefinition[];
}
