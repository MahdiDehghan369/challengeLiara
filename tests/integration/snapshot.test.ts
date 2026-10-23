import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { setEnv } from '../../src/ops/env.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { AuditLog } from '../../src/safety/audit.js';
import { LiaraApiError } from '../../src/shared/errors.js';
import { Secret } from '../../src/shared/secret.js';
import { takeSnapshot } from '../../src/sre/snapshot.js';
import { noKeepAlive } from '../helpers/no-pool-fetch.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-snapshot-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

async function world() {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  liara.ledger.record({ app: 'shop', mode: 'api', result: 'success' });
  // a recent env change through the gate → audit log
  await setEnv(liara.env, 'shop', { JWT_SECRET: new Secret('super-secret-value-1') }, { approver: new ScriptedApprover(['approved']), audit: new AuditLog(dataDir) });
  await mock.settle();
  mock.injectScenario('shop', 'missing-env');
  const deps = {
    liara,
    catalog: new PlanCatalog(liara.cli),
    urlFor: (n: string) => liara.mock!.servers.urlFor(n),
    probe: { count: 1, timeoutMs: 5000, fetchImpl: noKeepAlive },
    dataDir,
  };
  return { liara, mock, deps };
}

describe('takeSnapshot (mock)', () => {
  it('collects every source in parallel, timed, as plain JSON', async () => {
    const w = await world();
    const s = await takeSnapshot('shop', 900, w.deps);
    expect(s.partial).toBe(false);
    expect(s.failed).toEqual([]);
    const src = s.sources;
    expect(src.app).toMatchObject({ ok: true, value: { name: 'shop', scale: 1, planID: 'small-g2' } });
    expect(src.plan).toMatchObject({ ok: true, value: { id: 'small-g2' } });
    expect(src.lastDeploy).toMatchObject({ ok: true, value: { result: 'success' } });
    expect(src.events.ok && src.events.value.some((e) => e.kind === 'crash')).toBe(true);
    expect(src.logs.ok && src.logs.value.some((l) => l.level === 'error' && l.text.includes('Invalid URL'))).toBe(true);
    expect(src.probe.ok && src.probe.value.availability).toBe(0);
    expect(src.metrics.ok && src.metrics.value.memory.applets.length).toBeGreaterThan(0);
    expect(src.disks.ok).toBe(true);
    expect(src.envChanges).toMatchObject({ ok: true, value: [{ tool: 'set_env', keys: ['JWT_SECRET'], result: 'ok' }] });
    for (const v of Object.values(src)) expect(v.ms).toBeGreaterThanOrEqual(0);

    const json = JSON.stringify(s);
    expect(JSON.parse(json)).toEqual(s);
    expect(json).not.toContain('super-secret-value-1');
  });

  it('acceptance: a failing source → partial:true + the failed sources listed', async () => {
    const w = await world();
    w.liara.events.getEvents = async () => {
      throw new LiaraApiError('down', { status: 503, messageFa: 'سرور لیارا در دسترس نیست' });
    };
    const s = await takeSnapshot('shop', 900, { ...w.deps, urlFor: undefined as never });
    expect(s.partial).toBe(true);
    expect(s.failed.sort()).toEqual(['events', 'probe']);
    expect(s.sources.events).toMatchObject({ ok: false, errorFa: 'سرور لیارا در دسترس نیست', code: 'LIARA_API_ERROR' });
    expect(s.sources.app.ok).toBe(true);
    expect(s.sources.logs.ok).toBe(true);
  });

  it('unknown app: app and plan fail, the rest still reports', async () => {
    const w = await world();
    const s = await takeSnapshot('nope', 900, { liara: w.liara });
    expect(s.failed).toEqual(expect.arrayContaining(['app', 'plan']));
    expect(s.sources.envChanges).toMatchObject({ ok: true, value: [] });
  });
});
