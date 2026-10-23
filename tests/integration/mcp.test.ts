import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { MockLlm } from '../../src/llm/index.js';
import { createMcpServer } from '../../src/mcp/server.js';

const DEMO = join(import.meta.dirname, '..', '..', 'demo-apps', 'node-http500');
const root = mkdtempSync(join(tmpdir(), 'siavash-mcp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: Array<{ liara: LiaraClient; client: Client }> = [];
afterEach(async () => {
  for (const o of open) {
    await o.client.close();
    await o.liara.mock!.servers.close();
  }
  open = [];
});

async function world() {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const projectRoot = join(mkdtempSync(join(root, 'p-')), 'node-http500');
  cpSync(DEMO, projectRoot, { recursive: true, filter: (src) => !src.split(sep).includes('node_modules') });
  const config = { liara: { token: undefined, teamId: undefined, mode: 'mock' as const }, deployMode: 'cli' as const, dataDir };
  const liara = createLiaraClient(config, { mockOptions: { asyncDelayMs: 1 } });
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  const mcp = createMcpServer({ config, liara, llm: new MockLlm(), urlFor: (n) => liara.mock!.servers.urlFor(n), projectRoot });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await mcp.server.connect(serverT);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientT);
  open.push({ liara, client });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { text };
    }
    return { isError: r.isError === true, body, text };
  };
  return { liara, mock, mcp, client, call, projectRoot };
}

describe('MCP server (T9.8)', { timeout: 60_000 }, () => {
  it('lists every registry tool plus the collaboration tools; confirm fields are advertised', async () => {
    const w = await world();
    const { tools } = await w.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names.length).toBe(w.mcp.registry.list().length + 4);
    for (const n of ['list_apps', 'app_overview', 'restart_app', 'delete_app', 'rollback_app', 'deploy_project', 'diagnose_app', 'fix_issue', 'get_fix_brief', 'report_fix_done', 'get_incident_status', 'list_open_incidents']) expect(names).toContain(n);
    const restart = tools.find((t) => t.name === 'restart_app')!;
    expect(Object.keys(restart.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['app', 'confirm_token', 'confirm_app_name']));
  });

  it('R0 runs at once', async () => {
    const w = await world();
    const r = await w.call('list_apps');
    expect(r.body.status).toBe('ok');
    expect(r.text).toContain('shop');
  });

  it('R1 is two-step: approval_required + token → executed; a token is single-use and bound to the params', async () => {
    const w = await world();
    const first = await w.call('restart_app', { app: 'shop' });
    expect(first.body).toMatchObject({ status: 'approval_required', risk: 'R1' });
    expect(String(first.body.plan)).toContain('restart');
    const token = first.body.confirm_token as string;
    expect(token.length).toBeGreaterThan(10);

    const second = await w.call('restart_app', { app: 'shop', confirm_token: token });
    expect(second.body.status).toBe('ok');
    expect(second.text).toContain('"confirmed": true');

    const reused = await w.call('restart_app', { app: 'shop', confirm_token: token });
    expect(reused.isError).toBe(true);

    const other = await w.call('restart_app', { app: 'shop' });
    w.mock.createApp({ name: 'blog', planID: 'small-g2', platform: 'node' });
    const swapped = await w.call('restart_app', { app: 'blog', confirm_token: other.body.confirm_token });
    expect(swapped.isError).toBe(true);
  });

  it('R3 needs the app name typed by the user', async () => {
    const w = await world();
    const first = await w.call('delete_app', { app: 'shop' });
    expect(first.body).toMatchObject({ status: 'approval_required', risk: 'R3', requires_confirm_app_name: true });
    const token = first.body.confirm_token as string;
    const wrong = await w.call('delete_app', { app: 'shop', confirm_token: token, confirm_app_name: 'shopp' });
    expect(wrong.isError).toBe(true);
    await w.mock.settle();
    expect(w.mock.apps.has('shop')).toBe(true);
    const right = await w.call('delete_app', { app: 'shop', confirm_token: token, confirm_app_name: 'shop' });
    expect(right.body.status).toBe('ok');
    await w.mock.settle();
    expect(w.mock.apps.has('shop')).toBe(false);
  });

  it('acceptance: diagnose → fix (code → handoff) → get_fix_brief → report_fix_done → status', async () => {
    const w = await world();
    w.mock.injectScenario('shop', 'http-500');
    const diag = await w.call('diagnose_app', { app: 'shop' });
    expect(diag.body.status).toBe('ok');

    const ask = await w.call('fix_issue', { app: 'shop', choice: 'root' });
    expect(ask.body.status).toBe('approval_required');
    const fix = await w.call('fix_issue', { app: 'shop', choice: 'root', confirm_token: ask.body.confirm_token });
    expect(['ok', 'waiting_human']).toContain(fix.body.status);

    const { incidents } = (await w.call('list_open_incidents')).body as { incidents: Array<{ id: string; status: string }> };
    expect(incidents).toHaveLength(1);
    const id = incidents[0]!.id;
    expect(incidents[0]!.status).toBe('waiting-fix');

    const brief = await w.call('get_fix_brief', { incidentId: id });
    expect(brief.text).toContain('## 7. When done');
    expect(brief.text).toContain(`report_fix_done({ incidentId: "${id}" })`);

    const done = await w.call('report_fix_done', { incidentId: id, commit: 'abc1234' });
    expect(done.body).toMatchObject({ status: 'ok', incidentId: id });
    expect((await w.call('get_incident_status', { incidentId: id })).body).toMatchObject({ status: 'fix-reported', commit: 'abc1234' });

    const res = await w.client.readResource({ uri: `siavash://incidents/${id}` });
    expect(JSON.stringify(res.contents)).toContain('fix-reported');
    const prompt = await w.client.getPrompt({ name: 'fix-incident', arguments: { incidentId: id } });
    expect(JSON.stringify(prompt.messages)).toContain('Fix Brief');
  });

  it('resources and prompts', async () => {
    const w = await world();
    const { resources } = await w.client.listResources();
    expect(resources.map((r) => r.uri)).toContain('liara://apps');
    const apps = await w.client.readResource({ uri: 'liara://apps' });
    expect(JSON.stringify(apps.contents)).toContain('shop');
    const { prompts } = await w.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['deploy-my-project', 'diagnose-my-site', 'fix-incident']);
    expect((await w.call('get_fix_brief', { incidentId: 'inc-none' })).isError).toBe(true);
  });

  it('an interactive pipeline stops with waiting_human instead of guessing', async () => {
    const w = await world();
    const ask = await w.call('deploy_project', { path: w.projectRoot });
    const run = await w.call('deploy_project', { path: w.projectRoot, confirm_token: ask.body.confirm_token });
    // the first question of the pipeline (the app name) needs the user: nothing is guessed or created
    expect(run.body).toMatchObject({ status: 'waiting_human' });
    expect(typeof run.body.question).toBe('string');
    expect(w.mock.apps.size).toBe(1);
  });
});
