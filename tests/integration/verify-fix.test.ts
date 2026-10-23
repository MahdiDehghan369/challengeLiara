import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient, type ScenarioKind } from '../../src/liara/index.js';
import { takeSnapshot, type SnapshotDeps } from '../../src/sre/snapshot.js';
import { compareMeasures, verifyFix, type Measures } from '../../src/sre/verify.js';
import { noKeepAlive } from '../helpers/no-pool-fetch.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-verifyfix-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});
const fast = { settleMs: 0, snapshots: 1, sleep: async () => {} };

async function world(kind: ScenarioKind) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  mock.injectScenario('shop', kind);
  const deps: SnapshotDeps = { liara, urlFor: (n) => liara.mock!.servers.urlFor(n), probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive } };
  const baseline = await takeSnapshot('shop', 300, deps);
  return { liara, mock, app, deps, baseline };
}

describe('verifyFix (mock)', () => {
  it('right fix → resolved, with a before/after table', async () => {
    const w = await world('missing-env');
    const fixedAt = Date.now();
    await w.liara.env.setEnv('shop', { DATABASE_URL: 'postgres://u:p@shop-db.internal:5432/shop' });
    await w.mock.settle();
    const r = await verifyFix('shop', w.baseline, { signalIds: ['missing-env'] }, w.deps, { ...fast, fixedAt });
    expect(r.verdict).toBe('resolved');
    expect(r.verdictFa).toBe('رفع شد');
    expect(r.next).toBe('done');
    expect(r.before).toMatchObject({ availability: 0, targets: ['missing-env'] });
    expect(r.after).toMatchObject({ availability: 100, critical: 0, targets: [] });
    const avail = r.table.find((x) => x.key === 'availability');
    expect(avail).toMatchObject({ before: '0', after: '100', better: true });
    expect(r.table.find((x) => x.key === 'target')).toMatchObject({ before: 'missing-env', better: true });
    for (const row of r.table) expect(row.labelFa).toMatch(/[؀-ۿ]/);
  });

  it('wrong fix (restart for missing-env) → unchanged → next hypothesis; at round 3 → give up', async () => {
    const w = await world('missing-env');
    const fixedAt = Date.now();
    await w.liara.apps.restartApp('shop');
    await w.mock.settle();
    const r = await verifyFix('shop', w.baseline, { signalIds: ['missing-env'] }, w.deps, { ...fast, fixedAt });
    expect(r.verdict).toBe('unchanged');
    expect(r.next).toBe('next-hypothesis');
    expect(r.after.targets).toEqual(['missing-env']);
    const last = await verifyFix('shop', w.baseline, { signalIds: ['missing-env'] }, w.deps, { ...fast, fixedAt, round: 3 });
    expect(last.next).toBe('give-up');
  });

  it('a "fix" that crashes the app → worse → suggest undo / rollback', async () => {
    const w = await world('http-500');
    const fixedAt = Date.now();
    w.mock.injectScenario('shop', 'crash-loop');
    const r = await verifyFix('shop', w.baseline, undefined, w.deps, { ...fast, fixedAt });
    expect(r.before.availability).toBe(50);
    expect(r.after.availability).toBe(0);
    expect(r.verdict).toBe('worse');
    expect(r.next).toBe('undo');
    expect(r.nextFa).toContain('rollback');
  });
});

describe('compareMeasures (pure)', () => {
  const m = (over: Partial<Measures>): Measures => ({ availability: 100, errorRate: 0, p95: 100, memory: 40, critical: 0, targets: [], ...over });
  it('improved: better numbers but the target is still there', () => {
    const r = compareMeasures(m({ availability: 50, errorRate: 50, critical: 1, targets: ['http-5xx-rate'] }), m({ availability: 80, errorRate: 20, critical: 1, targets: ['http-5xx-rate'] }));
    expect(r.verdict).toBe('improved');
  });
  it('slower p95 alone is not "worse"; same numbers are unchanged', () => {
    expect(compareMeasures(m({ p95: 100 }), m({ p95: 105 })).verdict).toBe('resolved');
    expect(compareMeasures(m({ critical: 1, targets: ['oom'] }), m({ critical: 1, targets: ['oom'] })).verdict).toBe('unchanged');
  });
});
