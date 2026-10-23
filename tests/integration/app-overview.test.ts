import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { getAppOverview } from '../../src/ops/service.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { LiaraApiError } from '../../src/shared/errors.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { opsTools, ToolRegistry } from '../../src/tools/index.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-overview-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });

async function world() {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  mock.updateEnvs(app, [{ key: 'APP_NAME', value: 'shop' }, { key: 'JWT_SECRET', value: 'x'.repeat(20) }]);
  await mock.settle();
  liara.ledger.record({ app: 'shop', mode: 'cli', version: 'v1', result: 'success' });
  const deps = {
    liara,
    catalog: new PlanCatalog(liara.cli),
    urlFor: (n: string) => liara.mock!.servers.urlFor(n),
    probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
  };
  return { liara, mock, deps };
}

describe('getAppOverview (mock)', () => {
  it('collects every section in parallel', async () => {
    const w = await world();
    const o = await getAppOverview('shop', { ...w.deps, units: { cpu: 'cores', memory: 'bytes' } });
    expect(o.partial).toBe(false);
    expect(o.failed).toEqual([]);
    expect(o.status).toMatchObject({ ok: true, value: { name: 'shop', scale: 1, planID: 'small-g2', isDeployed: true } });
    expect(o.plan).toMatchObject({ ok: true, value: { id: 'small-g2', ramMb: 512 } });
    expect(o.lastDeploy).toMatchObject({ ok: true, value: { version: 'v1', result: 'success' } });
    expect(o.envCount).toEqual({ ok: true, value: 2 });
    expect(o.domains).toEqual({ ok: true, value: [] });
    expect(o.disks.ok).toBe(true);
    expect(o.events.ok && o.events.value.length).toBeGreaterThan(0);
    expect(o.probe).toMatchObject({ ok: true, value: { availability: 100 } });
    const m = o.metrics.ok ? o.metrics.value.applets[0] : undefined;
    // the mock reports cores and bytes; with the units stated, % of the plan is computed
    expect(m?.memoryPct).toBeGreaterThan(0);
    expect(m?.memoryPct).toBeLessThan(100);
  });

  it('metric % stays undefined while units are unknown (OQ-3)', async () => {
    const w = await world();
    const o = await getAppOverview('shop', w.deps);
    const m = o.metrics.ok ? o.metrics.value.applets[0] : undefined;
    expect(m?.memory).toBeGreaterThan(0);
    expect(m?.memoryPct).toBeUndefined();
  });

  it('acceptance: one failing source does not break the overview', async () => {
    const w = await world();
    w.liara.domains.listDomains = async () => {
      throw new LiaraApiError('boom', { status: 500, messageFa: 'خطای سرور لیارا' });
    };
    w.liara.metrics.getSummary = async () => {
      throw new Error('network down');
    };
    const o = await getAppOverview('shop', w.deps);
    expect(o.partial).toBe(true);
    expect(o.failed.sort()).toEqual(['domains', 'metrics']);
    expect(o.domains).toEqual({ ok: false, errorFa: 'خطای سرور لیارا', code: 'LIARA_API_ERROR' });
    expect(o.metrics.ok).toBe(false);
    expect(o.status.ok).toBe(true);
    expect(o.envCount).toEqual({ ok: true, value: 2 });
  });

  it('no URL resolver → probe skipped, not counted as failed; unknown app → status fails with a suggestion', async () => {
    const w = await world();
    const o = await getAppOverview('shop', { liara: w.liara });
    expect(o.probe).toMatchObject({ ok: false, code: 'SKIPPED' });
    expect(o.failed).toEqual([]);
    const missing = await getAppOverview('shoop', { liara: w.liara });
    expect(missing.status).toMatchObject({ ok: false, code: 'APP_NOT_FOUND' });
    expect(missing.status.ok ? '' : missing.status.errorFa).toContain('shop');
  });

  it('app_overview tool is R0 (no approval) and never leaks env values', async () => {
    const w = await world();
    const registry = new ToolRegistry();
    for (const t of opsTools({ catalog: w.deps.catalog })) registry.register(t);
    const approver = new ScriptedApprover([]);
    const r = await registry.invoke('app_overview', { app: 'shop' }, { liara: w.liara, approver });
    expect(r.ok).toBe(true);
    expect(approver.seen).toEqual([]);
    expect(r.forLlm).not.toContain('x'.repeat(20));
  });
});
