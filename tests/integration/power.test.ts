import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { planPower, powerApp } from '../../src/ops/service.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { probe } from '../../src/sre/health.js';
import { opsTools, ToolRegistry } from '../../src/tools/index.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-power-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });
const wait = { timeoutMs: 2000, intervalMs: 2, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) };

async function world() {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 5 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  const probeFor = (name: string) => async () => (await probe(await liara.mock!.servers.urlFor(name), { count: 1, timeoutMs: 5000, fetchImpl: noKeepAlive })).availability === 100;
  return { liara, mock, probeFor };
}

describe('restart / start / stop (mock)', () => {
  it('acceptance: stop is confirmed by the real state (scale 0, 503), not just "accepted"', async () => {
    const w = await world();
    const approver = new ScriptedApprover(['approved']);
    const r = await powerApp(w.liara.apps, 'stop', 'shop', { approver }, { wait });
    expect(r.status).toBe('executed');
    if (r.status !== 'executed') return;
    expect(r.result).toMatchObject({ action: 'stop', confirmed: true, scale: 0 });
    expect(r.result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(w.mock.apps.get('shop')?.scale).toBe(0);
    expect((await probe(await w.liara.mock!.servers.urlFor('shop'), { count: 1, fetchImpl: noKeepAlive })).statusHistogram['503']).toBe(1);
    expect(approver.seen[0]).toMatchObject({ toolName: 'stop_app', risk: Risk.R2 });
  });

  it('start waits for running + probe; restart confirms the app serves again', async () => {
    const w = await world();
    const approver = new ScriptedApprover(['approved']);
    await powerApp(w.liara.apps, 'stop', 'shop', { approver }, { wait });
    const started = await powerApp(w.liara.apps, 'start', 'shop', { approver }, { wait, probe: w.probeFor('shop') });
    expect(started.status === 'executed' && started.result.scale).toBe(1);
    const restarted = await powerApp(w.liara.apps, 'restart', 'shop', { approver }, { wait, probe: w.probeFor('shop') });
    expect(restarted.status === 'executed' && restarted.result.confirmed).toBe(true);
    expect(w.mock.apps.get('shop')?.events.some((e) => e.text === 'App restarted')).toBe(true);
    expect(approver.seen.map((p) => [p.toolName, p.risk])).toEqual([
      ['stop_app', Risk.R2],
      ['start_app', Risk.R1],
      ['restart_app', Risk.R1],
    ]);
  });

  it('a restart that never becomes healthy is not reported as done', async () => {
    const w = await world();
    w.mock.injectScenario('shop', 'crash-loop');
    const r = powerApp(w.liara.apps, 'restart', 'shop', { approver: new ScriptedApprover(['approved']) }, { wait: { ...wait, timeoutMs: 60 }, probe: w.probeFor('shop') });
    await expect(r).rejects.toMatchObject({ code: 'WAIT_TIMEOUT' });
  });

  it('cards: downtime warning without zero-downtime; stop of a production/protected app is R3', () => {
    expect(planPower('restart', 'shop', {}, { zeroDowntime: false, downtimeSec: 12 }).impactFa).toContain('12');
    expect(planPower('restart', 'shop', {}, {}).impactFa).toContain('zero-downtime');
    expect(planPower('restart', 'shop', {}, { zeroDowntime: true }).impactFa).not.toContain('zero-downtime');
    expect(planPower('stop', 'shop', {}).risk).toBe(Risk.R2);
    expect(planPower('stop', 'shop', { risk: { productionApps: ['shop'] } }).risk).toBe(Risk.R3);
    expect(planPower('stop', 'shop', { risk: { protectedApps: ['shop'] } }).risk).toBe(Risk.R3);
  });

  it('tools: one gate per call; denied stop changes nothing', async () => {
    const w = await world();
    const registry = new ToolRegistry();
    for (const t of opsTools({ power: { wait, probeFor: w.probeFor } })) registry.register(t);
    const approver = new ScriptedApprover(['approved']);
    const r = await registry.invoke('restart_app', { app: 'shop' }, { liara: w.liara, approver });
    expect(r.ok).toBe(true);
    expect(r.ok && r.forLlm).toContain('"confirmed":true');
    expect(approver.seen).toHaveLength(1);
    const denied = await registry.invoke('stop_app', { app: 'shop' }, { liara: w.liara, approver: new ScriptedApprover(['denied']) });
    expect(denied.ok).toBe(false);
    expect(w.mock.apps.get('shop')?.scale).toBe(1);
  });
});
