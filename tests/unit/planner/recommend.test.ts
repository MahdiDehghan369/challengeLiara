import { describe, expect, it } from 'vitest';
import { neededRamMb, PlanCatalog, recommendPlans, recommendUpgrade, type PlanEntry } from '../../../src/planner/index.js';
import { PLATFORMS } from '../../../src/analyzer/platform-map.js';
import { ValidationError } from '../../../src/shared/errors.js';
import { loadRecorded } from '../../helpers/fixtures.js';

const recorded = loadRecorded<Array<Record<string, string>>>('cli.plan-list.json');
const catalog = (raw: unknown = recorded) => new PlanCatalog({ planList: async () => raw });
const ids = (opts: Array<{ plan: PlanEntry }>) => opts.map((o) => o.plan.id);

describe('neededRamMb', () => {
  it('platform minimum, size, goal and traffic', () => {
    expect(neededRamMb({ platform: 'node' })).toBe(512);
    expect(neededRamMb({ platform: 'django' })).toBe(1024);
    expect(neededRamMb({ platform: 'node', sizeMb: 500 })).toBe(1024);
    expect(neededRamMb({ platform: 'node', goal: 'production' })).toBe(1024);
    expect(neededRamMb({ platform: 'next', goal: 'production', traffic: 'high' })).toBe(8192);
  });
});

describe('recommendPlans (recorded catalog)', () => {
  it('node demo → small / small / medium with costs and Persian reasons', async () => {
    const r = await recommendPlans(catalog(), { platform: 'node', goal: 'test' });
    expect(r.options.map((o) => o.tier)).toEqual(['economy', 'recommended', 'performance']);
    expect(ids(r.options)).toEqual(['small-g2', 'small-g2', 'medium-g2']);
    expect(r.options[1]?.monthlyToman).toBe(474998.4);
    for (const o of r.options) expect(o.reasonFa).toMatch(/[؀-ۿ]/);
  });

  it('django production with medium traffic → recommended covers 4GB', async () => {
    const r = await recommendPlans(catalog(), { platform: 'django', goal: 'production', traffic: 'medium', bundle: 'standard' });
    expect(r.neededRamMb).toBe(4096);
    expect(ids(r.options)).toEqual(['medium-g2', 'standard-plus-g2', 'pro-g2']);
    expect(r.options[1]?.monthlyToman).toBe(1475000);
  });

  it('need above every plan → the largest plan, marked as top', async () => {
    const r = await recommendPlans(catalog(recorded.slice(0, 2)), { platform: 'next', goal: 'production', traffic: 'high' });
    expect(r.neededRamMb).toBe(8192);
    expect(ids(r.options)).toEqual(['medium-g2', 'medium-g2', 'medium-g2']);
    expect(r.options[1]?.reasonFa).toBe(r.options[2]?.reasonFa);
  });

  it('acceptance: recommended is always available (property over platforms × goals × traffic)', async () => {
    const cat = catalog(recorded.map((p) => ({ ...p })));
    const plans = await cat.list();
    plans[1]!.available = false; // medium-g2 withdrawn
    for (const platform of PLATFORMS) {
      for (const goal of ['test', 'production'] as const) {
        for (const traffic of [undefined, 'low', 'medium', 'high'] as const) {
          const r = await recommendPlans(cat, { platform, goal, ...(traffic ? { traffic } : {}) });
          for (const o of r.options) expect(o.plan.available).toBe(true);
          expect(r.options[1]?.plan.id).not.toBe('medium-g2');
        }
      }
    }
  });

  it('a large project needs disk: plans smaller than twice its size are skipped', async () => {
    const r = await recommendPlans(catalog(), { platform: 'node', sizeMb: 8000 });
    for (const o of r.options) expect(o.plan.diskGb).toBeGreaterThanOrEqual(16);
  });

  it('no usable plan → clear error', async () => {
    await expect(recommendPlans(catalog(), { platform: 'node', sizeMb: 10_000_000 })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('recommendUpgrade', () => {
  it('usage under 80% → no upgrade', async () => {
    const a = await recommendUpgrade(catalog(), 'small-g2', { memoryPct: 40, cpuPct: 10 });
    expect(a).toMatchObject({ needed: false, next: undefined });
    expect(a.current.id).toBe('small-g2');
  });

  it('memory high → next plan with more RAM', async () => {
    const a = await recommendUpgrade(catalog(), 'small-g2', { memoryPct: 92 });
    expect(a.needed).toBe(true);
    expect(a.next?.id).toBe('medium-g2');
    expect(a.reasonFa).toContain('medium-g2');
  });

  it('cpu high on standard-base (1 CPU) → skips plans without more CPU', async () => {
    const a = await recommendUpgrade(catalog(), 'standard-base-g2', { cpuPct: 95 });
    expect(a.next?.cpu).toBeGreaterThan(1);
  });

  it('already the largest plan → needed but no next plan', async () => {
    const plans = await catalog().list();
    const top = plans.reduce((x, y) => (y.ramMb > x.ramMb ? y : x));
    const a = await recommendUpgrade(catalog(), top.id, { memoryPct: 99 });
    expect(a).toMatchObject({ needed: true, next: undefined });
  });

  it('unknown current plan → ValidationError', async () => {
    await expect(recommendUpgrade(catalog(), 'nope', { memoryPct: 99 })).rejects.toBeInstanceOf(ValidationError);
  });
});
