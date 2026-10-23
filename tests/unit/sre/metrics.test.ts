import { describe, expect, it } from 'vitest';
import type { MetricPoint, MetricSeriesResult } from '../../../src/liara/index.js';
import { parsePlanList } from '../../../src/planner/plans.js';
import {
  analyzeSeries,
  collectMetrics,
  detectMonotonicGrowth,
  detectSawtooth,
  detectSpikes,
  percentOfPlan,
  seriesStats,
} from '../../../src/sre/metrics.js';
import { loadRecorded } from '../../helpers/fixtures.js';

const T0 = 1_760_000_000_000;
const MIN = 60_000;
const series = (values: number[], stepMs = MIN): MetricPoint[] => values.map((value, i) => ({ ts: T0 + i * stepMs, value }));
const plans = parsePlanList(loadRecorded('cli.plan-list.json'));
const small = plans.find((p) => p.id === 'small-g2')!;
const MB = 1024 * 1024;

describe('seriesStats', () => {
  it('current, avg, min, max, p95 and slope per hour', () => {
    // +1 per minute → +60 per hour, perfect fit
    const s = seriesStats(series([10, 11, 12, 13, 14, 15]));
    expect(s).toMatchObject({ count: 6, current: 15, avg: 12.5, min: 10, max: 15, p95: 15 });
    expect(s.slopePerHour).toBeCloseTo(60, 6);
    expect(s.r2).toBeCloseTo(1, 6);
  });

  it('unsorted input and non-finite points are handled; empty → undefined', () => {
    const s = seriesStats([{ ts: T0 + MIN, value: 2 }, { ts: T0, value: 1 }, { ts: T0 + 2 * MIN, value: Number.NaN }]);
    expect(s).toMatchObject({ count: 2, current: 2 });
    expect(seriesStats([])).toMatchObject({ count: 0, current: undefined, avg: undefined, slopePerHour: undefined });
  });
});

describe('percentOfPlan (OQ-3: unit must be stated)', () => {
  it('cores / bytes / percent against the plan; unknown → undefined', () => {
    expect(percentOfPlan(0.25, 'cpu', 'cores', small)).toBe(50);
    expect(percentOfPlan(256 * MB, 'memory', 'bytes', small)).toBe(50);
    expect(percentOfPlan(42, 'memory', 'percent', small)).toBe(42);
    expect(percentOfPlan(256 * MB, 'memory', 'unknown', small)).toBeUndefined();
    expect(percentOfPlan(1, 'cpu', 'cores', undefined)).toBeUndefined();
  });
});

describe('detectors', () => {
  it('monotonic growth (leak) vs. noisy flat memory', () => {
    const leak = series([200, 210, 221, 230, 242, 251, 262, 270, 283, 290].map((v) => v * MB));
    expect(detectMonotonicGrowth(leak)).toMatchObject({ detected: true });
    expect(detectMonotonicGrowth(leak).growth).toBeCloseTo(0.45, 2);
    const flat = series([200, 205, 198, 203, 199, 204, 197, 202].map((v) => v * MB));
    expect(detectMonotonicGrowth(flat).detected).toBe(false);
    expect(detectMonotonicGrowth(series([1, 2, 3])).detected).toBe(false); // too few points
  });

  it('sawtooth: grow → sudden drop (OOM + restart), twice', () => {
    const saw = series([100, 200, 300, 450, 500, 120, 220, 330, 480, 510, 110, 150]);
    const r = detectSawtooth(saw);
    expect(r.detected).toBe(true);
    expect(r.drops.map((d) => [d.from, d.to])).toEqual([
      [500, 120],
      [510, 110],
    ]);
    // a steady decline is not a sawtooth; nor is a small dip
    expect(detectSawtooth(series([500, 450, 400, 350, 300])).detected).toBe(false);
    expect(detectSawtooth(series([100, 200, 300, 280, 320])).detected).toBe(false);
  });

  it('z-score spikes; flat series has none', () => {
    const s = series([10, 11, 10, 9, 10, 11, 10, 95, 10, 9, 10, 11]);
    expect(detectSpikes(s).map((p) => p.value)).toEqual([95]);
    expect(detectSpikes(series([5, 5, 5, 5]))).toEqual([]);
  });
});

describe('analyzeSeries / collectMetrics', () => {
  const result = (kind: 'cpu' | 'memory', applets: Record<string, number[]>): MetricSeriesResult => ({
    kind,
    unit: 'unknown',
    series: Object.entries(applets).map(([applet, values]) => ({ applet, points: series(values) })),
    dropped: 0,
    end: undefined,
  });

  it('each applet separately; % only with a stated unit and a plan', () => {
    const mem = result('memory', {
      'shop-a': [200, 210, 221, 230, 242, 251, 262, 270].map((v) => v * MB),
      'shop-b': [100, 300, 480, 90, 300, 490, 95].map((v) => v * MB),
    });
    const unknown = analyzeSeries(mem, { plan: small });
    expect(unknown.applets.map((a) => a.applet)).toEqual(['shop-a', 'shop-b']);
    expect(unknown.applets[0]?.percent.current).toBeUndefined();

    const known = analyzeSeries(mem, { plan: small, unit: 'bytes' });
    const [a, b] = known.applets;
    expect(a?.percent.current).toBeCloseTo((270 / 512) * 100, 1);
    expect(a?.growth.detected).toBe(true);
    expect(b?.sawtooth.detected).toBe(true);
    expect(b?.growth.detected).toBe(false);
  });

  it('collectMetrics fetches cpu + memory for the window', async () => {
    const calls: string[] = [];
    const source = {
      getSeries: async (app: string, kind: 'cpu' | 'memory' | 'network-receive' | 'network-transmit', windowSec: number) => {
        calls.push(`${app}:${kind}:${windowSec}`);
        return result(kind as 'cpu' | 'memory', { [`${app}-1`]: [0.1, 0.2, 0.15] });
      },
    };
    const r = await collectMetrics(source, 'shop', 3600, { plan: small, units: { cpu: 'cores' } });
    expect(calls.sort()).toEqual(['shop:cpu:3600', 'shop:memory:3600']);
    expect(r.cpu.applets[0]?.percent.max).toBe(40);
    expect(r.memory.applets[0]?.percent.max).toBeUndefined();
  });
});
