import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLiaraClient } from '../../src/liara/index.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { LLM_OUTPUT_MAX, readTools, ToolRegistry, type ToolContext } from '../../src/tools/index.js';

const dataDir = mkdtempSync(join(tmpdir(), 'read-tools-'));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

async function setup() {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir }, { mockOptions: { asyncDelayMs: 1 } });
  const state = liara.mock!.state;
  const app = state.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  await liara.env.setEnv('shop', { APP_NAME: 'shop', DATABASE_URL: 'postgres://u:supersecretpw@db:5432/shop' });
  app.disks.push({ _id: 'd1', name: 'data', size: 10, usage: 9, mountedTo: '/app/data', createdAt: new Date().toISOString() });
  state.domains.push({ _id: 'dm1', name: 'shop.ir', type: 'PROJECT', project: 'shop', status: 'CONNECTED', certificatesStatus: 'ACTIVE', redirectTo: null, redirectStatus: null, created_at: new Date().toISOString(), CNameRecord: 'shop.liara.run' });
  state.injectScenario('shop', 'http-500');
  for (let i = 0; i < 400; i++) state.log(app, `GET /api/orders/${i} 200 ${i % 40}ms ${'x'.repeat(80)}`);
  await state.settle();
  const approver = new ScriptedApprover([]);
  const reg = new ToolRegistry();
  for (const t of readTools()) reg.register(t);
  const ctx: ToolContext = { liara, approver };
  return { reg, ctx, approver, liara };
}

const ARGS: Record<string, Record<string, unknown>> = {
  list_apps: {},
  get_app: { app: 'shop' },
  get_billing: {},
  list_plans: {},
  get_metrics_summary: { app: 'shop' },
  get_metrics_series: { app: 'shop', kind: 'memory', windowSec: 7200 },
  get_logs: { app: 'shop', windowSec: 3600 },
  get_events: { app: 'shop' },
  list_deployments: { app: 'shop' },
  list_domains: { app: 'shop' },
  list_disks: { app: 'shop' },
  list_backups: { app: 'shop', disk: 'data' },
  list_env: { app: 'shop' },
  list_databases: {},
  get_limits: {},
};

describe('R0 read tools over mock Liara', () => {
  it('registers every required tool, all R0', async () => {
    const { reg } = await setup();
    expect(reg.list().map((t) => t.name).sort()).toEqual(Object.keys(ARGS).sort());
    for (const t of reg.list()) expect(t.risk, t.name).toBe(Risk.R0);
  });

  it.each(Object.keys(ARGS).map((n) => [n]))('%s: runs without approval, output < 4000 chars, no secrets', async (name) => {
    const { reg, ctx, approver } = await setup();
    const r = await reg.invoke(name, ARGS[name], ctx);
    expect(r.ok, r.forLlm).toBe(true);
    expect(r.forLlm.length).toBeLessThan(LLM_OUTPUT_MAX);
    expect(r.forLlm).not.toContain('supersecretpw');
    expect(approver.seen).toHaveLength(0);
  });

  it('get_logs summarises: level counts, top error cluster, grep and limit', async () => {
    const { reg, ctx } = await setup();
    const all = JSON.parse((await reg.invoke('get_logs', { app: 'shop', windowSec: 3600, limit: 5 }, ctx)).forLlm) as {
      total: number;
      byLevel: Record<string, number>;
      topErrors: Array<{ sample: string }>;
      last: string[];
    };
    expect(all.total).toBeGreaterThan(400);
    expect(all.byLevel.error).toBeGreaterThan(0);
    expect(all.topErrors[0]?.sample).toContain("reading 'length'");
    expect(all.last).toHaveLength(5);
    const grep = JSON.parse((await reg.invoke('get_logs', { app: 'shop', grep: 'TYPEERROR' }, ctx)).forLlm) as { total: number };
    expect(grep.total).toBe(1);
  });

  it('list_env masks values; list_disks warns above 80%; list_plans is normalised', async () => {
    const { reg, ctx } = await setup();
    const env = (await reg.invoke('list_env', { app: 'shop' }, ctx)).forLlm;
    expect(env).toContain('DATABASE_URL');
    expect(env).not.toContain('postgres://');
    expect((await reg.invoke('list_disks', { app: 'shop' }, ctx)).forLlm).toContain('90');
    const plans = JSON.parse((await reg.invoke('list_plans', {}, ctx)).forLlm) as Array<{ plan: string; ramGb: number }>;
    expect(plans[0]).toMatchObject({ plan: 'small-g2', ramGb: 0.5 });
  });

  it('get_app on a typo returns the closest-name suggestion as a readable error', async () => {
    const { reg, ctx } = await setup();
    const r = await reg.invoke('get_app', { app: 'shp' }, ctx);
    expect(r).toMatchObject({ ok: false, error: { code: 'APP_NOT_FOUND' } });
    expect(r.forLlm).toContain('shop');
  });
});
