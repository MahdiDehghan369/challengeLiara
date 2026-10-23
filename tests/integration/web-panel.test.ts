import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { MockLlm } from '../../src/llm/index.js';
import { startWebPanel, type WebPanel } from '../../src/ui/web/server.js';
import { noKeepAlive as noPoolFetch } from '../helpers/no-pool-fetch.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-web-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: Array<{ liara: LiaraClient; panel: WebPanel }> = [];
afterEach(async () => {
  for (const o of open) {
    await o.panel.close();
    await o.liara.mock!.servers.close();
  }
  open = [];
});

async function world() {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const config = { liara: { token: undefined, teamId: undefined, mode: 'mock' as const }, deployMode: 'cli' as const, dataDir };
  const liara = createLiaraClient(config, { mockOptions: { asyncDelayMs: 1 } });
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  const panel = await startWebPanel({ config, liara, llm: new MockLlm(), urlFor: (n) => liara.mock!.servers.urlFor(n), projectRoot: root }, { port: 0 });
  open.push({ liara, panel });
  const base = new URL(panel.url).origin;
  const req = async (path: string, init: { method?: string; body?: unknown; token?: string | null } = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (init.token !== null) headers['x-siavash-token'] = init.token ?? panel.token;
    const r = await noPoolFetch(`${base}${path}`, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test reads nested JSON
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };
  return { panel, req, base };
}

describe('web panel (T9.10)', { timeout: 60_000 }, () => {
  it('serves the page, but every API call needs the token (401 otherwise)', async () => {
    const w = await world();
    const page = await noPoolFetch(`${w.base}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('سیاوش');
    expect((await w.req('/api/tools', { token: null })).status).toBe(401);
    expect((await w.req('/api/tools', { token: 'wrong' })).status).toBe(401);
    expect((await w.req('/api/info')).body.mode).toBe('mock');
  });

  it('R0 runs at once; R1 needs the confirm token from the approval card', async () => {
    const w = await world();
    const apps = await w.req('/api/call', { body: { name: 'list_apps', args: {} } });
    expect(apps.body.answer.status).toBe('ok');
    expect(JSON.stringify(apps.body.answer)).toContain('shop');

    const first = await w.req('/api/call', { body: { name: 'restart_app', args: { app: 'shop' } } });
    expect(first.body.answer).toMatchObject({ status: 'approval_required', risk: 'R1' });
    const token = first.body.answer.confirm_token as string;
    const second = await w.req('/api/call', { body: { name: 'restart_app', args: { app: 'shop', confirm_token: token } } });
    expect(second.body.answer.status).toBe('ok');
  });

  it('lists the limits catalog: every item has an alternative', async () => {
    const w = await world();
    const r = await w.req('/api/limits');
    const items = (r.body.groups as Array<{ items: Array<{ alternativeFa: string }> }>).flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(10);
    for (const i of items) expect(i.alternativeFa.length).toBeGreaterThan(10);
  });

  it('refuses a public host without a token', async () => {
    await expect(startWebPanel({} as never, { host: '0.0.0.0' })).rejects.toThrow(/SIAVASH_UI_TOKEN/);
  });
});
