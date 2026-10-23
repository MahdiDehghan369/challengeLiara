import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { judgeHealth, runPipeline, verifyStep, type VerifyDeps, type VerifyResult, type VerifyState } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient, type ScenarioKind } from '../../src/liara/index.js';
import { ScriptedUi } from '../../src/ui/cli/scripted-ui.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-verify-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

/** No pooled sockets: per-test servers close and their ports get reused. */
const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });

async function setup(opts: { scenario?: ScenarioKind; stopped?: boolean } = {}) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  const rec = liara.ledger.record({ app: 'shop', mode: 'api', port: 3000 });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  if (opts.scenario) mock.injectScenario('shop', opts.scenario);
  if (opts.stopped) {
    mock.setScale(app, 0);
    await mock.settle();
  }
  const ui = new ScriptedUi([]);
  const handed: VerifyResult[] = [];
  const deps: VerifyDeps = {
    liara,
    ui,
    urlFor: (name) => liara.mock!.servers.urlFor(name),
    probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
    wait: { timeoutMs: 50, intervalMs: 5, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    observeMs: 0,
    onUnhealthy: (r) => void handed.push(r),
  };
  const state: VerifyState = { appName: 'shop', deployment: { id: rec.id, mode: 'api', result: 'success' } };
  const run = () => runPipeline({ id: 'deploy', steps: [verifyStep<VerifyState>(deps)] }, { state });
  return { liara, mock, ui, deps, state, run, handed, recId: rec.id };
}

describe('verify step (mock Liara)', () => {
  it('healthy: running, probe 100%, no crash or errors → healthAfter in the ledger', async () => {
    const w = await setup();
    const r = await w.run();
    expect(`${r.status} ${r.messageFa ?? ''}`).toBe('done ');
    expect(r.state.verify).toMatchObject({ verdict: 'healthy', score: 100, availability: 100, crashEvents: [], errorClusters: 0 });
    expect(w.liara.ledger.latest('shop')?.healthAfter).toEqual({ score: 100, verdict: 'healthy' });
    expect(w.handed).toEqual([]);
  });

  it('acceptance: missing-env → failed with reasons and hand-off to SRE', async () => {
    const w = await setup({ scenario: 'missing-env' });
    const r = await w.run();
    expect(r).toMatchObject({ status: 'failed', failedStep: 'verify' });
    expect(r.messageFa).toContain('دارم بررسی می‌کنم');
    const v = r.state.verify!;
    expect(v.verdict).toBe('failed');
    expect(v.availability).toBe(0);
    expect(v.crashEvents.length).toBeGreaterThan(0);
    expect(v.errorClusters).toBeGreaterThan(0);
    expect(v.reasonsFa.length).toBeGreaterThanOrEqual(2);
    expect(w.handed).toHaveLength(1);
    expect(w.liara.ledger.latest('shop')?.healthAfter?.verdict).toBe('failed');
    expect(w.ui.notes[0]?.body).toContain('•');
  });

  it('db-connection → the knowledge base names the cause (logs are matched after redaction)', async () => {
    const w = await setup({ scenario: 'db-connection' });
    const r = await w.run();
    expect(r.status).toBe('failed');
    expect(r.state.verify?.knownPatterns.map((k) => k.id)).toContain('db-econnrefused-localhost-postgres');
    expect(r.state.verify?.reasonsFa.some((x) => x.includes('الگوی شناخته‌شده'))).toBe(true);
  });

  it('http-500 on / but /health ok → degraded (pipeline continues, still handed off)', async () => {
    const w = await setup({ scenario: 'http-500' });
    const r = await w.run();
    expect(r.status).toBe('done');
    expect(r.state.verify).toMatchObject({ verdict: 'degraded', availability: 50 });
    expect(w.handed).toHaveLength(1);
  });

  it('stopped app → not running → failed', async () => {
    const w = await setup({ stopped: true });
    const r = await w.run();
    expect(r.status).toBe('failed');
    expect(r.state.verify?.verdict).toBe('failed');
    expect(r.state.verify?.availability).toBeUndefined();
  });
});

describe('judgeHealth (pure)', () => {
  const base = { running: true, url: 'https://x.liara.run', crashEvents: [] as string[], errorClusters: 0, knownPatterns: [] };
  const probeOf = (availability: number) => ({ availability }) as Parameters<typeof judgeHealth>[0]['probe'];

  it('healthy / degraded / failed with reasons', () => {
    expect(judgeHealth({ ...base, probe: probeOf(100) })).toEqual({ verdict: 'healthy', score: 100, reasonsFa: [] });
    const deg = judgeHealth({ ...base, probe: probeOf(100), errorClusters: 2 });
    expect(deg.verdict).toBe('degraded');
    expect(deg.score).toBe(70);
    const crash = judgeHealth({ ...base, probe: probeOf(100), crashEvents: ['Back-off restarting failed container'] });
    expect(crash.verdict).toBe('failed');
    expect(crash.score).toBeLessThanOrEqual(30);
    expect(judgeHealth({ ...base, running: false, probe: undefined })).toMatchObject({ verdict: 'failed', score: 0 });
  });
});
