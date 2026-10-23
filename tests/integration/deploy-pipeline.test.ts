import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readProjectState } from '../../src/agent/project-state.js';
import { runDeployPipeline, runRedeploy, type DeployPipelineDeps } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { deployTools, ToolRegistry } from '../../src/tools/index.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';

const DEMO = join(import.meta.dirname, '..', '..', 'demo-apps', 'node-express-ok');
const root = mkdtempSync(join(tmpdir(), 'siavash-pipeline-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });
const config = { liara: { token: undefined, teamId: undefined, mode: 'mock' as const }, deployMode: 'cli' as const };

/** A clean copy of the demo app (no node_modules): the pipeline writes liara.json and .siavash/. */
function demoCopy(): string {
  const dir = join(mkdtempSync(join(root, 'p-')), 'node-express-ok');
  cpSync(DEMO, dir, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  return dir;
}

function world() {
  const liara = createLiaraClient({ liara: config.liara, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const extra = {
    urlFor: (app: string) => liara.mock!.servers.urlFor(app),
    probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
    wait: { timeoutMs: 2000, intervalMs: 2, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)) },
    observeMs: 0,
    pollMs: 1,
  };
  return { liara, extra };
}

const ANSWERS: ScriptedAnswer[] = [
  { match: /نام اپ/, answer: '' },
  { match: /هدف/, answer: 'test' },
  { match: /پلن/, answer: 'recommended' },
  { match: /APP_NAME/, answer: '' },
  { match: /liara\.json/, answer: 'write' },
];

describe('deploy pipeline end to end (mock) — acceptance: siavash deploy demo-apps/node-express-ok', () => {
  it('preflight → analyze → plan → provision → configure → deploy → verify → summary, all green', async () => {
    const dir = demoCopy();
    const { liara, extra } = world();
    const ui = new ScriptedUi(ANSWERS);
    const approver = new ScriptedApprover(['approved']);
    const deps: DeployPipelineDeps = { config, liara, ui, ops: { approver }, useLlm: false, ...extra };
    const r = await runDeployPipeline(dir, deps);

    expect(`${r.status} ${r.failedStep ?? ''} ${r.messageFa ?? ''}`).toBe('done  ');
    expect(r.steps).toEqual({
      preflight: 'done',
      analyze: 'done',
      'plan-billing': 'done',
      provision: 'done',
      configure: 'done',
      deploy: 'done',
      verify: 'done',
      summary: 'done',
    });
    expect(ui.remaining).toBe(0);

    // the only cards: the R2 deploy plan and the env batch (app creation + deploy were on the plan card)
    expect(approver.seen.map((p) => [p.toolName, p.risk])).toEqual([
      ['approve_deploy_plan', Risk.R2],
      ['set_env', Risk.R1],
    ]);

    const app = liara.mock!.state.apps.get('node-express-ok');
    expect(app?.isDeployed).toBe(true);
    expect(Object.fromEntries(app!.envs)).toEqual({ APP_NAME: 'node-express-ok', PORT: '3000' });
    expect(r.state.verify).toMatchObject({ verdict: 'healthy', score: 100 });
    expect(liara.ledger.latest('node-express-ok')).toMatchObject({ result: 'success', version: 'v1', healthAfter: { verdict: 'healthy', score: 100 } });

    // summary card + project.json
    const card = ui.notes.find((n) => n.title.includes('node-express-ok') && n.body.includes('آدرس'));
    expect(card?.body).toContain('https://node-express-ok.liara.run');
    expect(card?.body).toContain('small-g2');
    expect(card?.body).toContain('siavash redeploy node-express-ok');
    expect(r.state.summary).toMatchObject({ url: 'https://node-express-ok.liara.run', planId: 'small-g2', verdict: 'healthy' });
    expect(readProjectState(dir)).toMatchObject({ app: 'node-express-ok', platform: 'node', port: 3000, planID: 'small-g2', deployMode: 'cli' });
    expect(JSON.parse(readFileSync(join(dir, 'liara.json'), 'utf8'))).toEqual({ app: 'node-express-ok', port: 3000, platform: 'node' });
    // the demo's own .liaraignore is kept
    expect(readFileSync(join(dir, '.liaraignore'), 'utf8')).toContain('*.log');
    // the demo app in the repo is untouched
    expect(existsSync(join(DEMO, 'liara.json'))).toBe(false);

    // redeploy: own R1 card, new version, project.json updated
    const ui2 = new ScriptedUi([]);
    const approver2 = new ScriptedApprover(['approved']);
    const again = await runRedeploy(dir, { config, liara, ui: ui2, ops: { approver: approver2 }, ...extra });
    expect(`${again.status} ${again.messageFa ?? ''}`).toBe('done ');
    expect(approver2.seen.map((p) => [p.toolName, p.risk])).toEqual([['deploy_app', Risk.R1]]);
    expect(liara.ledger.list('node-express-ok').map((d) => d.version)).toEqual(['v1', 'v2']);
    expect(readProjectState(dir)?.lastDeploymentId).toBe(again.state.deployment?.id);
  });

  it('tools: redeploy_app through the registry asks exactly one R1 card; deploy_project is R1 to start', async () => {
    const dir = demoCopy();
    const { liara, extra } = world();
    const first = await runDeployPipeline(dir, { config, liara, ui: new ScriptedUi(ANSWERS), ops: { approver: new ScriptedApprover(['approved']) }, useLlm: false, ...extra });
    expect(first.status).toBe('done');

    const registry = new ToolRegistry();
    for (const t of deployTools({ config, ui: new ScriptedUi([]), redeploy: extra, pipeline: extra })) registry.register(t);
    const approver = new ScriptedApprover(['approved']);
    const res = await registry.invoke('redeploy_app', { path: dir }, { liara, approver });
    expect(res.ok).toBe(true);
    expect(res.forLlm).toContain('"status":"done"');
    expect(approver.seen.map((p) => [p.toolName, p.risk])).toEqual([['redeploy_app', Risk.R1]]);
    expect(liara.ledger.list('node-express-ok')).toHaveLength(2);

    expect(registry.get('deploy_project')).toBeDefined();
    const denied = await registry.invoke('deploy_project', { path: dir }, { liara, approver: new ScriptedApprover(['denied']) });
    expect(denied.ok).toBe(false);
    expect(liara.ledger.list('node-express-ok')).toHaveLength(2);
  });

  it('nothing is created when the deploy-plan card is denied', async () => {
    const dir = demoCopy();
    const { liara, extra } = world();
    const ui = new ScriptedUi(ANSWERS.slice(0, 3));
    const r = await runDeployPipeline(dir, { config, liara, ui, ops: { approver: new ScriptedApprover(['denied']) }, useLlm: false, ...extra });
    expect(r).toMatchObject({ status: 'failed', failedStep: 'plan-billing' });
    expect(liara.mock!.state.apps.size).toBe(0);
    expect(readProjectState(dir)).toBeUndefined();
  });
});
