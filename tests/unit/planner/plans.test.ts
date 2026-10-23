import { describe, expect, it } from 'vitest';
import { estimateCost, parsePlanList, PlanCatalog, PLAN_CACHE_TTL_MS } from '../../../src/planner/index.js';
import { ExternalCommandError, ValidationError } from '../../../src/shared/errors.js';
import { loadRecorded } from '../../helpers/fixtures.js';

const recorded = loadRecorded<unknown[]>('cli.plan-list.json');

function source(raw: unknown = recorded) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    planList: async () => {
      calls++;
      return raw;
    },
  };
}

describe('parsePlanList (recorded plan:list, OQ-5)', () => {
  it('normalises string rows with thousands commas, sorted by price', () => {
    const plans = parsePlanList(recorded);
    expect(plans).toHaveLength(recorded.length);
    expect(plans[0]).toEqual({
      id: 'small-g2',
      kind: 'app',
      cpu: 0.5,
      ramMb: 512,
      diskGb: 5,
      priceMonthlyToman: 474998.4,
      bundlePricesToman: { free: 0, standard: 275000, pro: 475000 },
      available: true,
    });
    expect(plans.find((p) => p.id === 'standard-base-g2')).toMatchObject({ ramMb: 2048, cpu: 1, diskGb: 20, priceMonthlyToman: 1474999.2 });
    for (let i = 1; i < plans.length; i++) expect(plans[i]!.priceMonthlyToman).toBeGreaterThanOrEqual(plans[i - 1]!.priceMonthlyToman);
    expect(plans.every((p) => p.priceHourlyToman === undefined)).toBe(true);
  });

  it('drops malformed rows and non-arrays', () => {
    expect(parsePlanList({ Plan: 'x' })).toEqual([]);
    expect(parsePlanList([null, { Plan: 'a', RAM: '1', CPU: '1' }, { Plan: 'b', RAM: 'n/a', CPU: '1', Price: '1' }, { Plan: 'c', RAM: '1', CPU: '1', Price: '1,000' }])).toEqual([
      expect.objectContaining({ id: 'c', priceMonthlyToman: 1000, diskGb: 0 }),
    ]);
  });
});

describe('PlanCatalog', () => {
  it('caches for ten minutes; fresh bypasses', async () => {
    let t = 0;
    const src = source();
    const cat = new PlanCatalog(src, { now: () => t });
    await cat.list();
    t = PLAN_CACHE_TTL_MS - 1;
    await cat.list();
    expect(src.calls).toBe(1);
    t = PLAN_CACHE_TTL_MS;
    await cat.list();
    expect(src.calls).toBe(2);
    await cat.list({ fresh: true });
    expect(src.calls).toBe(3);
  });

  it('planById maps an app planID to resources', async () => {
    const cat = new PlanCatalog(source());
    expect(await cat.planById('medium-g2')).toMatchObject({ ramMb: 1024, cpu: 1 });
    expect(await cat.planById('nope')).toBeUndefined();
    await expect(cat.requirePlan('nope')).rejects.toBeInstanceOf(ValidationError);
  });

  it('acceptance: CLI unavailable → clear Persian error, no made-up catalog', async () => {
    const cat = new PlanCatalog({
      planList: async () => {
        throw Object.assign(new Error('spawn liara ENOENT'), { code: 'ENOENT' });
      },
    });
    const e = (await cat.list().catch((x: unknown) => x)) as ExternalCommandError;
    expect(e).toBeInstanceOf(ExternalCommandError);
    expect(e.messageFa).toContain('CLI');
  });

  it('empty output → ValidationError, not an empty catalog', async () => {
    await expect(new PlanCatalog(source([])).list()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('estimateCost', () => {
  it('app only: uses Price, or the bundle column when given', async () => {
    const cat = new PlanCatalog(source());
    expect(await estimateCost(cat, { appPlanId: 'small-g2' })).toEqual({
      items: [{ kind: 'app', id: 'small-g2', monthlyToman: 474998.4 }],
      totalMonthlyToman: 474998.4,
      complete: true,
    });
    expect((await estimateCost(cat, { appPlanId: 'small-g2', bundle: 'standard' })).totalMonthlyToman).toBe(275000);
    // Free column is 0 → not a real price, falls back to Price.
    expect((await estimateCost(cat, { appPlanId: 'small-g2', bundle: 'free' })).totalMonthlyToman).toBe(474998.4);
  });

  it('db and disk prices are unknown (OQ-29): listed, not guessed, total marked incomplete', async () => {
    const r = await estimateCost(new PlanCatalog(source()), { appPlanId: 'medium-g2', db: { planId: 'db-x' }, diskGb: 5 });
    expect(r.items.map((i) => i.kind)).toEqual(['app', 'db', 'disk']);
    expect(r.items.slice(1).every((i) => i.monthlyToman === undefined && !!i.noteFa)).toBe(true);
    expect(r.totalMonthlyToman).toBe(824997.6);
    expect(r.complete).toBe(false);
  });
});
