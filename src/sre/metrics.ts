import type { MetricKind, MetricPoint, MetricSeriesResult, MetricUnit } from '../liara/index.js';
import type { PlanEntry } from '../planner/plans.js';
import { mean, percentile, round } from '../shared/stats.js';

/**
 * Metric statistics (T7.2). Pure functions over `MetricPoint[]`: stats (current/avg/max/p95/slope),
 * usage as % of the plan, monotonic memory growth (possible leak), sawtooth (grow then sudden drop =
 * OOM kill + restart) and z-score spikes. Every applet is reported separately.
 */

export interface SeriesStats {
  count: number;
  current: number | undefined;
  avg: number | undefined;
  min: number | undefined;
  max: number | undefined;
  p95: number | undefined;
  /** Least-squares slope, in value units per hour. */
  slopePerHour: number | undefined;
  /** Coefficient of determination of the linear fit (0..1). */
  r2: number | undefined;
}

const HOUR_MS = 3_600_000;

function sorted(points: MetricPoint[]): MetricPoint[] {
  return points.filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value)).sort((a, b) => a.ts - b.ts);
}

function linearFit(points: MetricPoint[]): { slope: number; r2: number } | undefined {
  if (points.length < 2) return undefined;
  const t0 = points[0]!.ts;
  const xs = points.map((p) => (p.ts - t0) / HOUR_MS);
  const ys = points.map((p) => p.value);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0) return undefined;
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, r2 };
}

export function seriesStats(points: MetricPoint[]): SeriesStats {
  const ps = sorted(points);
  const values = ps.map((p) => p.value);
  const fit = linearFit(ps);
  return {
    count: ps.length,
    current: ps.at(-1)?.value,
    avg: mean(values),
    min: values.length ? Math.min(...values) : undefined,
    max: values.length ? Math.max(...values) : undefined,
    p95: percentile(values, 95),
    slopePerHour: fit?.slope,
    r2: fit?.r2,
  };
}

/**
 * Usage as % of the plan's limit. TODO(OQ-3): Liara's metric units are unconfirmed, so the caller must
 * state the unit; `unknown` → undefined (never guessed).
 */
export function percentOfPlan(value: number | undefined, kind: MetricKind, unit: MetricUnit, plan: PlanEntry | undefined): number | undefined {
  if (value === undefined) return undefined;
  // already a percentage: no plan needed
  if (unit === 'percent') return value;
  if (!plan) return undefined;
  if (kind === 'cpu' && unit === 'cores' && plan.cpu > 0) return (value / plan.cpu) * 100;
  if (kind === 'memory' && unit === 'bytes' && plan.ramMb > 0) return (value / (plan.ramMb * 1024 * 1024)) * 100;
  return undefined;
}

export interface GrowthResult {
  detected: boolean;
  slopePerHour: number | undefined;
  r2: number | undefined;
  /** Total growth over the window relative to the first value (0.25 = +25%). */
  growth: number | undefined;
}

/**
 * Steady growth with few dips: a possible memory leak. Defaults: ≥ 6 points, R² ≥ 0.8, ≥ 10% growth,
 * at most 20% of the steps going down.
 */
export function detectMonotonicGrowth(
  points: MetricPoint[],
  opts: { minPoints?: number; minR2?: number; minGrowth?: number; maxDownFraction?: number } = {},
): GrowthResult {
  const ps = sorted(points);
  const fit = linearFit(ps);
  const first = ps[0]?.value;
  const last = ps.at(-1)?.value;
  const growth = first !== undefined && last !== undefined && first > 0 ? (last - first) / first : undefined;
  let downs = 0;
  for (let i = 1; i < ps.length; i++) if (ps[i]!.value < ps[i - 1]!.value) downs++;
  const detected =
    ps.length >= (opts.minPoints ?? 6) &&
    !!fit &&
    fit.slope > 0 &&
    fit.r2 >= (opts.minR2 ?? 0.8) &&
    (growth ?? 0) >= (opts.minGrowth ?? 0.1) &&
    downs / Math.max(1, ps.length - 1) <= (opts.maxDownFraction ?? 0.2);
  return { detected, slopePerHour: fit?.slope, r2: fit?.r2, growth };
}

export interface SawtoothResult {
  detected: boolean;
  /** Sudden drops after growth: `from` → `to` at `ts`. */
  drops: Array<{ ts: number; from: number; to: number }>;
}

/**
 * Grow-then-crash pattern (OOM kill + restart): a drop of ≥ `dropFraction` (default 40%) from a value
 * that is ≥ `highFraction` (default 70%) of the window max, after at least `minRise` rising steps.
 */
export function detectSawtooth(points: MetricPoint[], opts: { dropFraction?: number; highFraction?: number; minRise?: number } = {}): SawtoothResult {
  const ps = sorted(points);
  const max = ps.length ? Math.max(...ps.map((p) => p.value)) : 0;
  const drops: SawtoothResult['drops'] = [];
  let rising = 0;
  for (let i = 1; i < ps.length; i++) {
    const prev = ps[i - 1]!;
    const cur = ps[i]!;
    if (cur.value > prev.value) {
      rising++;
      continue;
    }
    const isDrop =
      prev.value > 0 &&
      (prev.value - cur.value) / prev.value >= (opts.dropFraction ?? 0.4) &&
      prev.value >= (opts.highFraction ?? 0.7) * max &&
      rising >= (opts.minRise ?? 2);
    if (isDrop) drops.push({ ts: cur.ts, from: prev.value, to: cur.value });
    rising = 0;
  }
  return { detected: drops.length > 0, drops };
}

/** Points whose z-score is at least `z` (default 3). A flat series has no spikes. */
export function detectSpikes(points: MetricPoint[], z = 3): Array<MetricPoint & { z: number }> {
  const ps = sorted(points);
  const m = mean(ps.map((p) => p.value));
  if (m === undefined || ps.length < 3) return [];
  const sd = Math.sqrt(ps.reduce((s, p) => s + (p.value - m) ** 2, 0) / ps.length);
  if (sd === 0) return [];
  return ps.map((p) => ({ ...p, z: round((p.value - m) / sd, 2) })).filter((p) => Math.abs(p.z) >= z);
}

export interface AppletAnalysis {
  applet: string;
  stats: SeriesStats;
  /** % of the plan limit (undefined while the unit is unknown, OQ-3). */
  percent: { current: number | undefined; max: number | undefined; p95: number | undefined };
  growth: GrowthResult;
  sawtooth: SawtoothResult;
  spikes: Array<MetricPoint & { z: number }>;
}

export interface MetricAnalysis {
  kind: MetricKind;
  unit: MetricUnit;
  applets: AppletAnalysis[];
}

/** Analyses one metric (all applets separately). `unit` overrides the series unit when known. */
export function analyzeSeries(
  series: MetricSeriesResult,
  opts: { plan?: PlanEntry; unit?: MetricUnit } = {},
): MetricAnalysis {
  const unit = opts.unit ?? series.unit;
  return {
    kind: series.kind,
    unit,
    applets: series.series.map((s) => {
      const stats = seriesStats(s.points);
      const pct = (v: number | undefined) => {
        const p = percentOfPlan(v, series.kind, unit, opts.plan);
        return p === undefined ? undefined : round(p, 1);
      };
      return {
        applet: s.applet,
        stats,
        percent: { current: pct(stats.current), max: pct(stats.max), p95: pct(stats.p95) },
        growth: detectMonotonicGrowth(s.points),
        sawtooth: detectSawtooth(s.points),
        spikes: detectSpikes(s.points),
      };
    }),
  };
}

export interface MetricsSource {
  getSeries(name: string, kind: MetricKind, windowSec: number): Promise<MetricSeriesResult>;
}

/** Fetches cpu + memory for a window and analyses them (the only impure helper here). */
export async function collectMetrics(
  source: MetricsSource,
  app: string,
  windowSec: number,
  opts: { plan?: PlanEntry; units?: Partial<Record<MetricKind, MetricUnit>> } = {},
): Promise<Record<'cpu' | 'memory', MetricAnalysis>> {
  const [cpu, memory] = await Promise.all([source.getSeries(app, 'cpu', windowSec), source.getSeries(app, 'memory', windowSec)]);
  const withUnit = (kind: MetricKind) => ({
    ...(opts.plan ? { plan: opts.plan } : {}),
    ...(opts.units?.[kind] ? { unit: opts.units[kind] } : {}),
  });
  return { cpu: analyzeSeries(cpu, withUnit('cpu')), memory: analyzeSeries(memory, withUnit('memory')) };
}
