import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readProjectState } from '../../src/agent/project-state.js';
import { createFixRouter, FixDoneSignals, type FixRouterDeps } from '../../src/coder/index.js';
import { runRedeploy } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { AuditLog } from '../../src/safety/audit.js';
import { runDoctor } from '../../src/sre/index.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';
import { noKeepAlive } from '../helpers/no-pool-fetch.js';

const DEMO = join(import.meta.dirname, '..', '..', 'demo-apps', 'node-http500');
const root = mkdtempSync(join(tmpdir(), 'siavash-handoff-'));
// Windows can hold a fresh .git dir for a few seconds after the last git call (EBUSY); rmSync's own
// maxRetries is not honoured there, so retry by hand.
afterAll(async () => {
  for (let i = 0; ; i++) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i >= 40 || (e as NodeJS.ErrnoException).code !== 'EBUSY') throw e;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}, 30_000);
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const BUG = '  const count = order.items.length;\n  const total = order.items.reduce(';
const FIX = '  const items = order.items ?? [];\n  const count = items.length;\n  const total = items.reduce(';

async function repo(git = true): Promise<string> {
  const dir = join(mkdtempSync(join(root, 'p-')), 'node-http500');
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  if (git) {
    const g = simpleGit(dir);
    await g.init();
    await g.addConfig('user.email', 'test@example.com').addConfig('user.name', 'test').addConfig('core.autocrlf', 'false');
    await g.add('.').commit('initial');
  }
  return dir;
}

/** The user's coding agent: edits src/orders.js and commits (never .siavash/). */
async function agentCommit(dir: string, change: 'fix' | 'noop', message: string): Promise<void> {
  const file = join(dir, 'src', 'orders.js');
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, change === 'fix' ? text.replace(BUG, FIX) : `${text}// looked at it\n`);
  const g = simpleGit(dir);
  await g.add('src');
  await g.commit(message);
}

async function world() {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  mock.injectScenario('shop', 'http-500');
  return { liara, mock, dataDir };
}

function routerDeps(w: Awaited<ReturnType<typeof world>>, dir: string, ui: ScriptedUi, onBrief: (round: number, text: string) => void): FixRouterDeps {
  const approver = new ScriptedApprover(['approved']);
  let round = 0;
  return {
    root: dir,
    ui,
    self: async () => ({ status: 'failed' }),
    redeploy: async (app, cwd) => {
      const r = await runRedeploy(cwd, {
        config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'cli' },
        liara: w.liara,
        ui: new ScriptedUi([]),
        ops: { approver },
        app,
        urlFor: (n) => w.liara.mock!.servers.urlFor(n),
        probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
        wait: { timeoutMs: 2000, intervalMs: 2, sleep: realSleep },
        observeMs: 0,
      });
      return { status: r.status };
    },
    validation: { timeoutMs: 60_000 },
    watch: { intervalMs: 20, timeoutMs: 20_000, sleep: realSleep },
    endpoint: 'GET /api/orders/2',
    // the brief "reaches" the user's agent through the clipboard
    copy: async (text) => {
      onBrief(++round, text);
      return true;
    },
  };
}

function doctorRun(w: Awaited<ReturnType<typeof world>>, answers: ScriptedAnswer[], router: (ui: ScriptedUi) => ReturnType<typeof createFixRouter>) {
  const ui = new ScriptedUi(answers);
  const codeFix = router(ui);
  return {
    ui,
    codeFix,
    run: () =>
      runDoctor('shop', {
        liara: w.liara,
        ui,
        ops: { approver: new ScriptedApprover(['approved']), audit: new AuditLog(w.dataDir) },
        catalog: new PlanCatalog(w.liara.cli),
        snapshot: { urlFor: (n) => w.liara.mock!.servers.urlFor(n), probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive }, units: { cpu: 'cores', memory: 'bytes' }, dataDir: w.dataDir },
        verify: { settleMs: 30, snapshots: 1, sleep: realSleep },
        wait: { timeoutMs: 2000, intervalMs: 2, sleep: realSleep },
        codeFix,
      }),
  };
}

describe('handoff to the user\'s agent (T8.15)', { timeout: 120_000 }, () => {
  it('acceptance: brief → simulated commit → validate → redeploy → resolved; the mode is remembered', async () => {
    const w = await world();
    const dir = await repo();
    const briefs: string[] = [];
    const { ui, codeFix, run } = doctorRun(
      w,
      [
        { match: /کدام راهکار/, answer: 'root' },
        { match: /چطور اصلاح شود/, answer: 'handoff' },
        { match: /commit جدید دیدم: «fix: handle orders without items/, answer: 'go' },
      ],
      (u) =>
        createFixRouter(
          routerDeps(w, dir, u, (_, text) => {
            briefs.push(text);
            void realSleep(50).then(() => agentCommit(dir, 'fix', 'fix: handle orders without items'));
          }),
        ),
    );
    const r = await run();

    expect(r.status).toBe('done');
    expect(r.state.rounds?.map((x) => [x.tool, x.execution])).toEqual([['code_patch', 'executed']]);
    expect(r.state.verification?.verdict).toBe('resolved');
    expect(w.mock.apps.get('shop')?.scenario).toBeUndefined();
    expect(briefs).toHaveLength(1);
    expect(briefs[0]).toContain('## 7. When done');
    expect(codeFix.lastRounds.map((x) => x.validation?.ok)).toEqual([true]);
    expect(existsSync(codeFix.lastRounds[0]!.briefPath)).toBe(true);
    expect(readProjectState(dir)?.fixMode).toBe('handoff');
    expect(ui.remaining).toBe(0);
  });

  it('an incomplete fix fails validation → a second-round brief with the new error → fixed → deployed', async () => {
    const w = await world();
    const dir = await repo();
    const briefs: string[] = [];
    const ui = new ScriptedUi([
      { match: /چطور اصلاح شود/, answer: 'handoff' },
      { match: /commit جدید دیدم: «chore: first try/, answer: 'go' },
      { match: /commit جدید دیدم: «fix: second try/, answer: 'go' },
    ]);
    const router = createFixRouter(
      routerDeps(w, dir, ui, (round, text) => {
        briefs.push(text);
        void realSleep(50).then(() => (round === 1 ? agentCommit(dir, 'noop', 'chore: first try') : agentCommit(dir, 'fix', 'fix: second try')));
      }),
    );
    const hyp = { id: 'h', titleFa: 'x', category: 'code' as const, confidence: 0.8, evidence: [], explanationFa: 'x', proposedFixes: [], howToVerifyFa: 'x', source: 'rules' as const };
    const res = await router.fix({ app: 'shop', hypothesis: hyp, error: "TypeError: Cannot read properties of undefined (reading 'length')\n    at summarize (/app/src/orders.js:14:29)", incidentId: 'inc-t-1' });

    expect(res.status).toBe('deployed');
    expect(router.lastRounds.map((x) => x.validation?.ok)).toEqual([false, true]);
    expect(briefs).toHaveLength(2);
    expect(briefs[1]).toContain('did not pass local validation');
    expect(ui.notes.some((n) => /دور 1/.test(n.body))).toBe(true);
  });

  it('report_fix_done resolves the wait; saved mode asks only for a confirmation; no git → Enter + file hash', async () => {
    const w = await world();
    const dir = await repo();
    const signals = new FixDoneSignals();
    const ui = new ScriptedUi([
      { match: /چطور اصلاح شود/, answer: 'handoff' },
      { match: /commit جدید دیدم/, answer: 'later' },
    ]);
    const deps = { ...routerDeps(w, dir, ui, () => void realSleep(50).then(() => signals.notify('inc-t-2'))), signals, watch: { intervalMs: 20, timeoutMs: 20_000, sleep: realSleep } };
    const hyp = { id: 'h', titleFa: 'x', category: 'code' as const, confidence: 0.8, evidence: [], explanationFa: 'x', proposedFixes: [], howToVerifyFa: 'x', source: 'rules' as const };
    const res = await createFixRouter(deps).fix({ app: 'shop', hypothesis: hyp, error: 'Error: boom', incidentId: 'inc-t-2' });
    expect(res.status).toBe('waiting-fix');

    // saved mode → a single confirmation, then the report-only mode is chosen instead
    const ui2 = new ScriptedUi([
      { match: /مثل دفعهٔ قبل/, answer: 'change' },
      { match: /چطور اصلاح شود/, answer: 'report' },
    ]);
    expect((await createFixRouter({ ...deps, ui: ui2 }).fix({ app: 'shop', hypothesis: hyp, error: 'Error: boom', incidentId: 'inc-t-3' })).status).toBe('reported');

    // no git: Enter with nothing changed → still waiting; nothing in the project was edited by us
    const plain = await repo(false);    const before = readFileSync(join(plain, 'src', 'orders.js'), 'utf8');
    const ui3 = new ScriptedUi([{ match: /چطور اصلاح شود/, answer: 'handoff' }, { match: /Enter/, answer: '' }]);
    const r3 = await createFixRouter({ ...routerDeps(w, plain, ui3, () => undefined) }).fix({ app: 'shop', hypothesis: hyp, error: 'Error: boom', incidentId: 'inc-t-4' });
    expect(r3.status).toBe('waiting-fix');
    expect(readFileSync(join(plain, 'src', 'orders.js'), 'utf8')).toBe(before);
  });
});
