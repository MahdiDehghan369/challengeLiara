import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { runCodePatch, type Patch } from '../../src/coder/index.js';
import { runRedeploy } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient, type ScenarioKind } from '../../src/liara/index.js';
import { MockLlm } from '../../src/llm/index.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { AuditLog } from '../../src/safety/audit.js';
import { runDoctor, type CodeFixRouter, type DoctorDeps } from '../../src/sre/index.js';
import { sreTools, ToolRegistry } from '../../src/tools/index.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';

const DEMO = join(import.meta.dirname, '..', '..', 'demo-apps', 'node-http500');
const root = mkdtempSync(join(tmpdir(), 'siavash-doctor-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});
const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const GOOD: Patch = {
  summaryFa: 'سفارش بدون آیتم دیگر خطای ۵۰۰ نمی‌دهد',
  rootCauseFa: 'order.items برای بعضی سفارش‌ها undefined است.',
  edits: [{ file: 'src/orders.js', search: '  const count = order.items.length;\n  const total = order.items.reduce(', replace: '  const items = order.items ?? [];\n  const count = items.length;\n  const total = items.reduce(' }],
  testsToAdd: [],
  riskFa: 'کم',
};

async function world(kind: ScenarioKind) {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  const deployedAt = Date.now() - 10;
  mock.injectScenario('shop', kind);
  if (kind === 'bad-release') {
    // the ledger knows both releases the scenario created: the good one and the broken current one,
    // deployed just before the crash started
    const [good, bad] = app.releases.slice(-2);
    liara.ledger.record({ app: 'shop', mode: 'api', sourceID: good!.sourceID, port: 3000, platform: 'node', result: 'success', startedAt: new Date(Date.now() - 3_600_000).toISOString() });
    liara.ledger.record({ app: 'shop', mode: 'api', sourceID: bad!.sourceID, port: 3000, platform: 'node', result: 'success', startedAt: new Date(deployedAt).toISOString() });
  }
  return { liara, mock, dataDir };
}

function doctorDeps(w: Awaited<ReturnType<typeof world>>, answers: ScriptedAnswer[], extra: Partial<DoctorDeps> = {}) {
  const approver = new ScriptedApprover(['approved']);
  const ui = new ScriptedUi(answers);
  const deps: DoctorDeps = {
    liara: w.liara,
    ui,
    ops: { approver, audit: new AuditLog(w.dataDir) },
    catalog: new PlanCatalog(w.liara.cli),
    snapshot: { urlFor: (n) => w.liara.mock!.servers.urlFor(n), probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive }, units: { cpu: 'cores', memory: 'bytes' }, dataDir: w.dataDir },
    verify: { settleMs: 30, snapshots: 1, sleep: realSleep },
    wait: { timeoutMs: 2000, intervalMs: 2, sleep: realSleep },
    reportsDir: join(w.dataDir, '..', 'reports'),
    ...extra,
  };
  return { deps, approver, ui };
}

async function httpFixRouter(liara: LiaraClient): Promise<CodeFixRouter> {
  const dir = join(mkdtempSync(join(root, 'p-')), 'node-http500');
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@example.com').addConfig('user.name', 'test').addConfig('core.autocrlf', 'false');
  await git.add('.').commit('initial');
  const approver = new ScriptedApprover(['approved']);
  return {
    fix: (req) =>
      runCodePatch(
        {
          llm: new MockLlm().on(() => true, { content: JSON.stringify(GOOD) }),
          ops: { approver },
          validation: { timeoutMs: 60_000 },
          redeploy: async (app, cwd) => {
            const r = await runRedeploy(cwd, {
              config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'cli' },
              liara,
              ui: new ScriptedUi([]),
              ops: { approver },
              app,
              preApproved: true,
              urlFor: (n) => liara.mock!.servers.urlFor(n),
              probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
              wait: { timeoutMs: 2000, intervalMs: 2, sleep: realSleep },
              observeMs: 0,
            });
            return { status: r.status };
          },
        },
        { root: dir, app: req.app, incidentId: req.incidentId, error: req.error, mode: 'deploy' },
      ),
  };
}

const SECRET_DB = 'postgres://app:db-pass-123@shop-db.internal:5432/shop';
const SCENARIOS: Array<[ScenarioKind, ScriptedAnswer[], string]> = [
  // the log does not name the variable → the user is asked for the name, then (hidden) for the value
  ['missing-env', [{ match: /کدام راهکار/, answer: 'root' }, { match: /نام متغیر/, answer: 'DATABASE_URL' }, { match: /DATABASE_URL/, answer: SECRET_DB }], 'set_env'],
  ['db-connection', [{ match: /کدام راهکار/, answer: 'root' }, { match: /DATABASE_URL/, answer: SECRET_DB }], 'set_env'],
  ['oom', [{ match: /کدام راهکار/, answer: 'quick' }], 'resize_app'],
  ['slow', [{ match: /کدام راهکار/, answer: 'quick' }], 'resize_app'],
  ['bad-release', [{ match: /کدام راهکار/, answer: 'quick' }], 'rollback_app'],
  ['http-500', [{ match: /کدام راهکار/, answer: 'root' }], 'code_patch'],
];

describe('doctor end to end (acceptance: all 6 mock scenarios resolved)', { timeout: 120_000 }, () => {
  it.each(SCENARIOS.map(([kind, answers, tool]) => ({ kind, answers, tool })))('$kind → $tool → resolved, incident report written', async ({ kind, answers, tool }) => {
    const w = await world(kind);
    const extra = kind === 'http-500' ? { codeFix: await httpFixRouter(w.liara) } : {};
    const { deps, approver, ui } = doctorDeps(w, answers, extra);
    const r = await runDoctor('shop', deps);

    expect(`${r.status} ${r.messageFa ?? ''}`).toBe('done ');
    expect(r.state.rounds?.map((x) => [x.tool, x.execution])).toEqual([[tool, 'executed']]);
    expect(r.state.verification?.verdict).toBe('resolved');
    expect(r.state.incident?.status).toBe('resolved');
    expect(w.mock.apps.get('shop')?.scenario).toBeUndefined();
    expect(ui.remaining).toBe(0);
    // findings were presented in the fixed format before anything ran
    const findings = ui.notes.find((n) => n.body.includes('علت محتمل'));
    expect(findings?.body).toMatch(/مشکل:[\s\S]*علت محتمل:[\s\S]*شواهد:[\s\S]*راهکار سریع:[\s\S]*راهکار ریشه‌ای:/);
    if (kind !== 'http-500') expect(approver.seen.map((p) => p.toolName)).toContain(tool);
    // report on disk, without the secret typed by the user
    const md = r.state.reportFiles?.markdown;
    expect(md && existsSync(md)).toBe(true);
    const text = (await import('node:fs')).readFileSync(md as string, 'utf8');
    expect(text).toContain('رفع شد');
    expect(text).not.toContain('db-pass-123');
  });

  it('diagnose mode changes nothing; a healthy app ends right after detection', async () => {
    const w = await world('missing-env');
    const { deps, approver } = doctorDeps(w, []);
    const r = await runDoctor('shop', deps, { mode: 'diagnose' });
    expect(r.status).toBe('done');
    expect(r.state.rca?.hypotheses[0]?.proposedFixes[0]?.actionType).toBe('set_env');
    expect(approver.seen).toEqual([]);
    expect(w.mock.apps.get('shop')?.scenario).toBe('missing-env');

    w.mock.resolve(w.mock.apps.get('shop')!);
    w.mock.start(w.mock.apps.get('shop')!, 'ok');
    const healthy = await runDoctor('shop', doctorDeps(await world('missing-env'), []).deps, { mode: 'diagnose' });
    expect(healthy.status).toBe('done');
  });

  it('tools: diagnose_app (R0) then fix_issue(root) resolves missing-env', async () => {
    const w = await world('missing-env');
    const { deps } = doctorDeps(w, [{ match: /نام متغیر/, answer: 'DATABASE_URL' }, { match: /DATABASE_URL/, answer: SECRET_DB }]);
    const registry = new ToolRegistry();
    for (const t of sreTools({ ...deps.snapshot, doctor: { ui: deps.ui, catalog: deps.catalog!, verify: deps.verify!, wait: deps.wait! } })) registry.register(t);
    const approver = new ScriptedApprover(['approved']);
    const diag = await registry.invoke('diagnose_app', { app: 'shop' }, { liara: w.liara, approver });
    expect(diag.ok).toBe(true);
    expect(approver.seen).toEqual([]);
    const fix = await registry.invoke('fix_issue', { app: 'shop', choice: 'root' }, { liara: w.liara, approver });
    expect(fix.ok).toBe(true);
    expect(fix.ok && fix.forLlm).toContain('"verdict":"resolved"');
    expect(approver.seen.map((p) => p.toolName)).toEqual(['fix_issue', 'set_env']);
  });
});
