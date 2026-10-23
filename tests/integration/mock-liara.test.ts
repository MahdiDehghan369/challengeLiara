import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AppsApi } from '../../src/liara/api/apps.js';
import { DeployApi } from '../../src/liara/api/deploy.js';
import { DisksApi } from '../../src/liara/api/disks.js';
import { LogsApi } from '../../src/liara/api/logs.js';
import { LiaraCli, type DeployEvent } from '../../src/liara/cli.js';
import { LiaraConsole } from '../../src/liara/console.js';
import { EnvApi } from '../../src/liara/env.js';
import { LiaraHttp } from '../../src/liara/http.js';
import {
  createCliMock,
  createConsoleMock,
  createMockFetch,
  MockAppServers,
  MockLiaraState,
  SCENARIOS,
  type ScenarioKind,
} from '../../src/liara/mock/index.js';
import { probe } from '../../src/sre/health.js';
import { noKeepAlive } from '../helpers/no-pool-fetch.js';

const TOKEN = 'mock-token-123456';
const tmp = mkdtempSync(join(tmpdir(), 'mock-liara-'));
const archive = join(tmp, 'src.tar.gz');
writeFileSync(archive, Buffer.alloc(2048, 7));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let servers: MockAppServers | undefined;
afterEach(async () => {
  await servers?.close();
  servers = undefined;
});

function world() {
  const state = new MockLiaraState({ asyncDelayMs: 5 });
  const http = new LiaraHttp({ token: TOKEN, fetchImpl: createMockFetch(state), sleep: async () => {} });
  const cli = new LiaraCli({ token: TOKEN, spawner: createCliMock(state) });
  const apps = new AppsApi(http);
  servers = new MockAppServers(state);
  return {
    state,
    http,
    cli,
    apps,
    env: new EnvApi(http, cli),
    deploy: new DeployApi(http),
    disks: new DisksApi(http, apps),
    logs: new LogsApi(http),
    servers,
  };
}

type World = ReturnType<typeof world>;

async function health(w: World, app: string, path = '/') {
  return probe(`${await w.servers.urlFor(app)}${path}`, { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive });
}

/** Availability with the histograms, error codes, timings and app state in the failure message. */
async function availability(w: World, app: string): Promise<string> {
  const r = await health(w, app);
  const a = w.state.apps.get(app);
  const samples = r.samples.map((s) => `${s.status ?? s.error}:${s.errorCode ?? ''}:${s.totalMs}ms`).join(',');
  const appState = a ? `scenario=${a.scenario ?? '-'} scale=${a.scale} releases=${a.releases.length}` : 'no-app';
  return `${r.availability} ${JSON.stringify(r.statusHistogram)} ${JSON.stringify(r.errorHistogram)} [${samples}] ${r.url} ${appState}`;
}

async function cliDeploy(w: World, app: string): Promise<DeployEvent[]> {
  const events: DeployEvent[] = [];
  for await (const e of w.cli.deploy({ cwd: tmp, app, port: 3000 })) events.push(e);
  return events;
}

async function apiDeploy(w: World, app: string): Promise<{ sourceID: string; releaseID: string }> {
  const sourceID = await w.deploy.uploadSource(app, archive);
  const releaseID = await w.deploy.createRelease(app, { sourceID, port: 3000, type: 'node' });
  await w.state.settle();
  return { sourceID, releaseID };
}

describe('mock Liara — end to end without network', () => {
  it('create app → set env → deploy (api and cli) → inject missing-env → set env → healthy', async () => {
    const w = world();
    await w.apps.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
    expect((await w.apps.getApp('shop', { fresh: true })).status).toBe('ACTIVE');

    await w.env.setEnv('shop', { APP_NAME: 'shop' });
    expect((await w.env.listEnv('shop')).map((e) => e.key)).toEqual(['APP_NAME']);

    await apiDeploy(w, 'shop');
    expect((await w.apps.getApp('shop', { fresh: true })).isDeployed).toBe(true);
    const cliEvents = await cliDeploy(w, 'shop');
    expect(cliEvents.at(-1)).toMatchObject({ type: 'done', version: 'v2' });
    expect(await availability(w, 'shop')).toMatch(/^100 /);

    w.state.injectScenario('shop', 'missing-env');
    const sick = await health(w, 'shop');
    expect(sick.availability).toBe(0);
    const logs = await w.logs.getLogs('shop', { windowSec: 600 });
    expect(logs.some((l) => l.text.includes('Invalid URL'))).toBe(true);

    await w.env.setEnv('shop', { DATABASE_URL: 'postgres://u:p@db.internal:5432/shop' });
    await w.state.settle();
    expect(await availability(w, 'shop')).toMatch(/^100 /);
    // the env merge kept the earlier variable (read-all → merge → send-all under replace semantics)
    expect((await w.env.listEnv('shop')).map((e) => e.key).sort()).toEqual(['APP_NAME', 'DATABASE_URL']);
  });

  it('async actions only take effect later (accepted semantics)', async () => {
    const w = world();
    await w.apps.createApp({ name: 'api', planID: 'small-g2', platform: 'node' });
    await w.apps.setScale('api', 0);
    expect((await w.apps.getApp('api', { fresh: true })).scale).toBe(1);
    await w.state.settle();
    expect((await w.apps.getApp('api', { fresh: true })).scale).toBe(0);
    expect((await health(w, 'api')).statusHistogram['503']).toBe(2);
  });

  it('requests without a token are rejected', async () => {
    const state = new MockLiaraState();
    const res = await createMockFetch(state)('https://api.liara.ir/v1/projects');
    expect(res.status).toBe(401);
  });
});

/** The right fix for each scenario. */
const FIXES: Record<ScenarioKind, (w: World, app: string) => Promise<void>> = {
  'missing-env': async (w, app) => void (await w.env.setEnv(app, { DATABASE_URL: 'postgres://u:p@db.internal:5432/x' })),
  'db-connection': async (w, app) => void (await w.env.setEnv(app, { DATABASE_URL: 'postgres://u:p@db.internal:5432/x' })),
  'crash-loop': async (w, app) => void (await cliDeploy(w, app)),
  'http-500': async (w, app) => void (await apiDeploy(w, app)),
  slow: async (w, app) => void (await w.apps.resizeApp(app, 'medium-g2')),
  oom: async (w, app) => void (await w.apps.resizeApp(app, 'medium-g2')),
  'disk-full': async (w, app) => void (await w.disks.resizeDisk(app, 'data', 10)),
  'bad-release': async (w, app) => {
    const a = w.state.apps.get(app);
    const previous = a?.releases.at(-2)?.sourceID as string;
    await w.deploy.createRelease(app, { sourceID: previous, port: 3000, type: 'node' });
  },
};

describe('scenarios are injected and resolved by the right fix', () => {
  it.each(SCENARIOS.map((s) => [s]))('%s', async (kind) => {
    const w = world();
    await w.apps.createApp({ name: 'svc', planID: 'small-g2', platform: 'node' });
    await apiDeploy(w, 'svc');
    w.state.injectScenario('svc', kind);
    expect(w.state.apps.get('svc')?.scenario).toBe(kind);
    expect(w.state.apps.get('svc')?.logs.some((l) => l.type === 'stderr')).toBe(true);

    await FIXES[kind](w, 'svc');
    await w.state.settle();
    expect(w.state.apps.get('svc')?.scenario).toBeUndefined();
    expect(await availability(w, 'svc')).toMatch(/^100 /);
  });

  it('a wrong fix does not resolve (restart does not fix missing-env)', async () => {
    const w = world();
    await w.apps.createApp({ name: 'svc', planID: 'small-g2', platform: 'node' });
    await apiDeploy(w, 'svc');
    w.state.injectScenario('svc', 'missing-env');
    await w.apps.restartApp('svc');
    await w.state.settle();
    expect(w.state.apps.get('svc')?.scenario).toBe('missing-env');
    expect(await availability(w, 'svc')).toMatch(/^0 /);
  });
});

describe('CLI and console mocks', () => {
  it('plan:list, empty db list, shell, zone check', async () => {
    const w = world();
    expect(Array.isArray(await w.cli.planList())).toBe(true);
    expect(await w.cli.dbList()).toEqual([]);
    await w.apps.createApp({ name: 'svc', planID: 'small-g2', platform: 'node' });
    expect((await w.cli.shell('svc', 'pwd')).stdout).toBe('/app');
    w.state.zones.add('shop.ir');
    expect((await w.cli.zoneCheck('shop.ir')).stdout).toContain('active');
    await expect(w.cli.zoneCheck('nope.ir')).rejects.toThrow();
  });

  it('LiaraConsole runs over the console mock; unknown project falls back to the CLI', async () => {
    const w = world();
    await w.apps.createApp({ name: 'svc', planID: 'small-g2', platform: 'node' });
    await w.env.setEnv('svc', { SECRET_KEY: 'super-secret-value-123' });
    const consoleApi = new LiaraConsole({ token: TOKEN, apps: w.apps, cli: w.cli, socketFactory: createConsoleMock(w.state) });
    const r = await consoleApi.runInContainer('svc', 'node -v');
    expect(r).toMatchObject({ stdout: 'v22.12.0', exitCode: 0, via: 'ws' });
    const envOut = await consoleApi.runInContainer('svc', 'env');
    expect(envOut.stdout).not.toContain('super-secret-value-123');

    const noWs = new LiaraConsole({ token: TOKEN, apps: w.apps, cli: w.cli, socketFactory: createConsoleMock(new MockLiaraState()) });
    expect(await noWs.runInContainer('svc', 'pwd')).toMatchObject({ stdout: '/app', via: 'cli' });
  });
});
