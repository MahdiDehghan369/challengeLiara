import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLiaraClient } from '../../src/liara/index.js';
import { planResize, resizeApp } from '../../src/ops/service.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { LiaraApiError } from '../../src/shared/errors.js';
import { opsTools, ToolRegistry } from '../../src/tools/index.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-resize-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const wait = { timeoutMs: 2000, intervalMs: 2, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

function world(balance?: number) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 5 } });
  const mock = liara.mock!.state;
  mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  if (balance !== undefined) mock.billing.balance = balance;
  const catalog = new PlanCatalog(liara.cli);
  return { liara, mock, catalog, b: { apps: liara.apps, billing: liara.billing, catalog } };
}

describe('resize_app (mock)', () => {
  it('R2 card: current → new, monthly difference, reason, undo; result confirmed in the app list', async () => {
    const w = world();
    const approver = new ScriptedApprover(['approved']);
    const r = await resizeApp(w.b, 'shop', 'medium-g2', { approver }, { reasonFa: 'RAM در ۲۴ ساعت گذشته به ۹۵٪ رسیده', wait });
    expect(r.status).toBe('executed');
    expect(w.mock.apps.get('shop')?.planID).toBe('medium-g2');
    const card = approver.seen[0]!;
    expect(card).toMatchObject({ toolName: 'resize_app', risk: Risk.R2, reasonFa: 'RAM در ۲۴ ساعت گذشته به ۹۵٪ رسیده', undo: { tool: 'resize_app', params: { app: 'shop', planID: 'small-g2' } } });
    expect(card.impactFa).toContain('small-g2');
    expect(card.impactFa).toContain('medium-g2');
    expect(card.impactFa).toContain('+');
    expect(card.costToman?.monthly).toBe(824997.6);
  });

  it('acceptance: insufficient balance → top-up request (like T5.4), no card, no change', async () => {
    const w = world(100_000);
    const approver = new ScriptedApprover(['approved']);
    const e = (await resizeApp(w.b, 'shop', 'pro-g2', { approver }, { wait }).catch((x: unknown) => x)) as LiaraApiError;
    expect(e).toBeInstanceOf(LiaraApiError);
    expect(e.code).toBe('INSUFFICIENT_BALANCE');
    expect(e.messageFa).toContain('console.liara.ir');
    expect(approver.seen).toEqual([]);
    expect(w.mock.apps.get('shop')?.planID).toBe('small-g2');
  });

  it('same plan → no-change; downgrade shows a negative difference', async () => {
    const w = world();
    expect(await resizeApp(w.b, 'shop', 'small-g2', { approver: new ScriptedApprover([]) })).toMatchObject({ status: 'no-change' });
    const plans = await w.catalog.list();
    const down = planResize('shop', plans.find((p) => p.id === 'medium-g2')!, plans.find((p) => p.id === 'small-g2')!, {});
    expect(down.impactFa).toContain('−');
  });

  it('tool: balance checked before the card; denied → nothing changes', async () => {
    const w = world();
    const registry = new ToolRegistry();
    for (const t of opsTools({ catalog: w.catalog, power: { wait } })) registry.register(t);
    const ok = await registry.invoke('resize_app', { app: 'shop', planID: 'medium-g2' }, { liara: w.liara, approver: new ScriptedApprover(['approved']) });
    expect(ok.ok).toBe(true);
    expect(w.mock.apps.get('shop')?.planID).toBe('medium-g2');

    const denied = await registry.invoke('resize_app', { app: 'shop', planID: 'small-g2' }, { liara: w.liara, approver: new ScriptedApprover(['denied']) });
    expect(denied.ok).toBe(false);
    expect(w.mock.apps.get('shop')?.planID).toBe('medium-g2');

    w.mock.billing.balance = 1;
    const approver = new ScriptedApprover(['approved']);
    const poor = await registry.invoke('resize_app', { app: 'shop', planID: 'pro-g2' }, { liara: w.liara, approver });
    expect(poor.ok).toBe(false);
    expect(!poor.ok && poor.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(approver.seen).toEqual([]);
  });
});
