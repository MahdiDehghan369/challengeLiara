import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { runCodePatch, type CodePatchDeps, type Patch } from '../../src/coder/index.js';
import { runRedeploy } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { MockLlm } from '../../src/llm/index.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { ValidationError } from '../../src/shared/errors.js';
import { ScriptedUi } from '../../src/ui/cli/scripted-ui.js';
import { noKeepAlive } from '../helpers/no-pool-fetch.js';

const DEMO = join(import.meta.dirname, '..', '..', 'demo-apps', 'node-http500');
const root = mkdtempSync(join(tmpdir(), 'siavash-codepatch-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

const STACK = "TypeError: Cannot read properties of undefined (reading 'length')\n    at summarize (/app/src/orders.js:15:29)\n    at Server.<anonymous> (/app/src/server.js:20:31)";

const GOOD: Patch = {
  summaryFa: 'سفارش بدون آیتم دیگر خطای ۵۰۰ نمی‌دهد',
  rootCauseFa: 'order.items برای سفارش‌های قدیمی undefined است.',
  edits: [{ file: 'src/orders.js', search: '  const count = order.items.length;\n  const total = order.items.reduce(', replace: '  const items = order.items ?? [];\n  const count = items.length;\n  const total = items.reduce(' }],
  testsToAdd: [{ file: 'test/missing-items.test.js', content: "const test = require('node:test');\nconst assert = require('node:assert');\nconst { summarize } = require('../src/orders');\ntest('no items', () => assert.strictEqual(summarize({ id: 'x' }).count, 0));\n" }],
  riskFa: 'کم',
};
/** Compiles and applies, but does not fix the bug: the demo's own test keeps failing. */
const BAD: Patch = {
  ...GOOD,
  summaryFa: 'تغییر بی‌اثر',
  edits: [{ file: 'src/orders.js', search: '  return { id: order.id, customer: order.customer, count, total };', replace: '  return { id: order.id, customer: order.customer, count, total }; // checked' }],
  testsToAdd: [],
};

async function project(opts: { git?: boolean } = {}): Promise<string> {
  const dir = join(mkdtempSync(join(root, 'p-')), 'node-http500');
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  if (opts.git !== false) {
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@example.com').addConfig('user.name', 'test').addConfig('core.autocrlf', 'false');
    await git.add('.').commit('initial');
  }
  return dir;
}

function world() {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'node-http500', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  return { liara, mock };
}

function deps(llm: MockLlm, approver: ScriptedApprover, liara?: LiaraClient): CodePatchDeps {
  return {
    llm,
    ops: { approver },
    ui: new ScriptedUi([]),
    validation: { timeoutMs: 60_000 },
    ...(liara
      ? {
          redeploy: async (app: string, dir: string) => {
            const r = await runRedeploy(dir, {
              config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'cli' },
              liara,
              ui: new ScriptedUi([]),
              ops: { approver },
              app,
              preApproved: true,
              urlFor: (n) => liara.mock!.servers.urlFor(n),
              probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
              wait: { timeoutMs: 2000, intervalMs: 2, sleep: (ms) => new Promise((res) => setTimeout(res, ms)) },
              observeMs: 0,
            });
            return { status: r.status, ...(r.state.verify ? { verdict: r.state.verify.verdict } : {}), ...(r.messageFa ? { messageFa: r.messageFa } : {}) };
          },
        }
      : {}),
  };
}

const input = (dir: string, mode: 'deploy' | 'apply-only' | 'show-only' = 'deploy') => ({ root: dir, app: 'node-http500', incidentId: 'inc-1', error: STACK, mode });
const reply = (p: Patch) => ({ content: JSON.stringify(p) });

async function expectPristine(dir: string, base: string) {
  const git = simpleGit(dir);
  expect((await git.status()).files).toEqual([]);
  expect((await git.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe(base);
  expect((await git.branchLocal()).all).not.toContain('siavash/fix-inc-1');
  expect(readFileSync(join(dir, 'src', 'orders.js'), 'utf8')).toContain('const count = order.items.length;');
  expect(existsSync(join(dir, 'test', 'missing-items.test.js'))).toBe(false);
}

describe('code_patch flow on demo-apps/node-http500 (mock Liara)', { timeout: 120_000 }, () => {
  it('acceptance: http-500 end to end — patch → tests green → R2 card with diff → commit → redeploy → healthy', async () => {
    const dir = await project();
    const { liara, mock } = world();
    mock.injectScenario('node-http500', 'http-500');
    const approver = new ScriptedApprover(['approved']);
    const r = await runCodePatch(deps(new MockLlm().on(() => true, reply(GOOD)), approver, liara), input(dir));

    expect(`${r.status} ${r.messageFa ?? ''}`).toBe('deployed ');
    expect(r.rounds).toBe(1);
    expect(r.validation).toMatchObject({ ok: true, skipped: false });
    expect(r.deploy).toMatchObject({ status: 'done', verdict: 'healthy' });
    // one card: code_patch R2 with the diff and the test result (deploy_app was covered by it)
    expect(approver.seen.map((p) => [p.toolName, p.risk])).toEqual([['code_patch', Risk.R2]]);
    expect(approver.seen[0]?.impactFa).toContain('+  const items = order.items ?? [];');
    expect(approver.seen[0]?.impactFa).toContain('همهٔ بررسی‌ها موفق بود');

    const git = simpleGit(dir);
    expect((await git.revparse(['--abbrev-ref', 'HEAD'])).trim()).toBe('siavash/fix-inc-1');
    expect((await git.log()).latest?.message).toBe('fix: سفارش بدون آیتم دیگر خطای ۵۰۰ نمی‌دهد (siavash incident inc-1)');
    // the only leftover is the agent's own project state written by the redeploy summary
    expect((await git.status()).files.map((f) => f.path)).toEqual(['.siavash/project.json']);
    expect(mock.apps.get('node-http500')?.scenario).toBeUndefined();
    expect(liara.ledger.latest('node-http500')?.result).toBe('success');
  });

  it('acceptance: tests keep failing → 2 correction rounds, then a complete revert', async () => {
    const dir = await project();
    const base = (await simpleGit(dir).revparse(['--abbrev-ref', 'HEAD'])).trim();
    const llm = new MockLlm().on(() => true, reply(BAD));
    const approver = new ScriptedApprover(['approved']);
    const r = await runCodePatch(deps(llm, approver), input(dir));
    expect(r.status).toBe('failed');
    expect(r.rounds).toBe(3);
    expect(r.messageFa).toContain('برگردانده');
    expect(llm.calls).toHaveLength(3);
    // the second attempt was told why the first failed
    expect(llm.calls[1]?.messages.map((m) => m.content ?? '').join('\n')).toContain('local validation failed');
    expect(approver.seen).toEqual([]);
    await expectPristine(dir, base);
  });

  it('acceptance: a denied card reverts everything', async () => {
    const dir = await project();
    const base = (await simpleGit(dir).revparse(['--abbrev-ref', 'HEAD'])).trim();
    const r = await runCodePatch(deps(new MockLlm().on(() => true, reply(GOOD)), new ScriptedApprover(['denied'])), input(dir, 'apply-only'));
    expect(r.status).toBe('rejected');
    await expectPristine(dir, base);
  });

  it('show-only changes nothing; apply-only commits without deploying', async () => {
    const dir = await project();
    const base = (await simpleGit(dir).revparse(['--abbrev-ref', 'HEAD'])).trim();
    const shown = await runCodePatch(deps(new MockLlm().on(() => true, reply(GOOD)), new ScriptedApprover([])), input(dir, 'show-only'));
    expect(shown.status).toBe('shown');
    expect(shown.diff).toContain('+  const items = order.items ?? [];');
    await expectPristine(dir, base);

    const { liara } = world();
    const applied = await runCodePatch(deps(new MockLlm().on(() => true, reply(GOOD)), new ScriptedApprover(['approved']), liara), input(dir, 'apply-only'));
    expect(applied.status).toBe('applied');
    expect(applied.commit).toBeTruthy();
    expect(applied.deploy).toBeUndefined();
    expect(liara.ledger.list('node-http500')).toEqual([]);
  });

  it('without git: backup in .siavash/backups, restored on denial', async () => {
    const dir = await project({ git: false });
    const original = readFileSync(join(dir, 'src', 'orders.js'), 'utf8');
    const r = await runCodePatch(deps(new MockLlm().on(() => true, reply(GOOD)), new ScriptedApprover(['denied'])), input(dir, 'apply-only'));
    expect(r.status).toBe('rejected');
    expect(readFileSync(join(dir, 'src', 'orders.js'), 'utf8')).toBe(original);
    expect(existsSync(join(dir, '.siavash', 'backups', 'inc-1'))).toBe(false);
    expect(existsSync(join(dir, 'test', 'missing-items.test.js'))).toBe(false);
  });

  it("refuses to touch files with the user's uncommitted changes", async () => {
    const dir = await project();
    writeFileSync(join(dir, 'src', 'orders.js'), `${readFileSync(join(dir, 'src', 'orders.js'), 'utf8')}\n// my local work\n`);
    const e = await runCodePatch(deps(new MockLlm().on(() => true, reply(GOOD)), new ScriptedApprover(['approved'])), input(dir, 'apply-only')).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(readFileSync(join(dir, 'src', 'orders.js'), 'utf8')).toContain('// my local work');
  });
});
