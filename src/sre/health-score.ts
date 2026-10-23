import { fa } from '../ui/cli/i18n/fa.js';
import type { Severity, Signal } from './detectors/types.js';

/**
 * Health score (T7.6): 0–100 from detector signals, a label and a one-sentence Persian summary.
 * The first critical signal alone takes the score below 50 (acceptance); further signals cost less.
 */

export type HealthLabel = 'healthy' | 'attention' | 'critical';

export interface HealthScore {
  score: number;
  label: HealthLabel;
  labelFa: string;
  summaryFa: string;
  counts: Record<Severity, number>;
}

export const SCORE_WEIGHTS = { firstCritical: 55, critical: 15, warn: 12, info: 3 } as const;

export function healthScore(app: string, signals: Signal[], opts: { failedSources?: string[] } = {}): HealthScore {
  const counts: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
  for (const s of signals) counts[s.severity] += 1;
  const penalty =
    (counts.critical > 0 ? SCORE_WEIGHTS.firstCritical + (counts.critical - 1) * SCORE_WEIGHTS.critical : 0) +
    counts.warn * SCORE_WEIGHTS.warn +
    counts.info * SCORE_WEIGHTS.info;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const label: HealthLabel = counts.critical > 0 || score < 50 ? 'critical' : counts.warn > 0 || score < 80 ? 'attention' : 'healthy';
  const h = fa.healthScore;
  const top = [...signals].sort((a, b) => rank(a.severity) - rank(b.severity))[0];
  const partial = opts.failedSources?.length ? h.partial(opts.failedSources.join(', ')) : '';
  const summaryFa = (top ? h.problems(app, signals.length, top.titleFa) : h.allGood(app)) + partial;
  return { score, label, labelFa: h.label[label] ?? label, summaryFa, counts };
}

function rank(s: Severity): number {
  return s === 'critical' ? 0 : s === 'warn' ? 1 : 2;
}
