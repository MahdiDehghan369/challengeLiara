import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi, closestName, levenshtein } from '../../../src/liara/api/apps.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { waitAppGone, waitAppRunning, waitAppScale, waitForState } from '../../../src/liara/wait.js';
import { LiaraApiError } from '../../../src/shared/errors.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type ProjectsFixture = { projects: Array<Record<string, unknown>> };
const fixture = () => loadFixture<ProjectsFixture>('projects.list.json');

function makeApi(now?: () => number) {
  const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
  return new AppsApi(h, now ? { now } : {});
}

function serveList(get: () => ProjectsFixture) {
  let calls = 0;
  server.use(
    http.get(`${BASE}/v1/projects`, () => {
      calls++;
      return HttpResponse.json(get());
    }),
  );
  return () => calls;
}

describe('AppsApi', () => {
  it('lists and normalizes apps (string scale → number)', async () => {
    serveList(fixture);
    const apps = await makeApi().listApps();
    expect(apps).toHaveLength(3);
    expect(apps[0]).toMatchObject({
      id: '64f0000000000000000000a1',
      name: 'shop-api',
      platform: 'node',
      scale: 1,
      planID: 'plan-small',
      isDeployed: true,
    });
    expect(apps[1]?.scale).toBe(0);
    expect(apps[0]?.raw._id).toBe('64f0000000000000000000a1');
  });

  it('caches the list for 5s', async () => {
    let t = 0;
    const calls = serveList(fixture);
    const api = makeApi(() => t);
    await api.listApps();
    t = 4_000;
    await api.listApps();
    expect(calls()).toBe(1);
    t = 5_001;
    await api.listApps();
    expect(calls()).toBe(2);
    await api.listApps({ fresh: true });
    expect(calls()).toBe(3);
  });

  it('resolveApp maps name → {id, name}', async () => {
    serveList(fixture);
    expect(await makeApi().resolveApp('blog-static')).toEqual({
      id: '64f0000000000000000000a2',
      name: 'blog-static',
    });
  });

  it('unknown app → APP_NOT_FOUND with the closest name suggested', async () => {
    serveList(fixture);
    const e = (await makeApi()
      .getApp('shop-apii')
      .catch((x: unknown) => x)) as LiaraApiError;
    expect(e).toBeInstanceOf(LiaraApiError);
    expect(e.code).toBe('APP_NOT_FOUND');
    expect(e.details.suggestion).toBe('shop-api');
    expect(e.messageFa).toContain('shop-api');
  });

  it('no suggestion when nothing is close', async () => {
    serveList(fixture);
    const e = (await makeApi()
      .getApp('totally-different-name')
      .catch((x: unknown) => x)) as LiaraApiError;
    expect(e.details.suggestion).toBeUndefined();
  });

  it('createApp sends the body; 409 → APP_NAME_TAKEN', async () => {
    let body: unknown;
    let calls = 0;
    server.use(
      http.post(`${BASE}/v1/projects`, async ({ request }) => {
        calls++;
        body = await request.json();
        return calls === 1 ? new HttpResponse(null, { status: 200 }) : new HttpResponse(null, { status: 409 });
      }),
    );
    const api = makeApi();
    const input = { name: 'new-app', planID: 'plan-small', platform: 'node' };
    expect(await api.createApp(input)).toEqual({ accepted: true });
    expect(body).toEqual(input);
    const e = (await api.createApp(input).catch((x: unknown) => x)) as LiaraApiError;
    expect(e.code).toBe('APP_NAME_TAKEN');
    expect(calls).toBe(2);
  });

  it('delete / scale / restart / resize hit the {name} endpoints and return accepted', async () => {
    const seen: string[] = [];
    server.use(
      http.delete(`${BASE}/v1/projects/:name`, ({ params }) => {
        seen.push(`DELETE ${String(params.name)}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/v1/projects/:name/actions/scale`, async ({ params, request }) => {
        seen.push(`scale ${String(params.name)} ${JSON.stringify(await request.json())}`);
        return HttpResponse.json({ message: 'ok' });
      }),
      http.post(`${BASE}/v1/projects/:name/actions/restart`, ({ params }) => {
        seen.push(`restart ${String(params.name)}`);
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(`${BASE}/v1/projects/:name/resize`, async ({ params, request }) => {
        seen.push(`resize ${String(params.name)} ${JSON.stringify(await request.json())}`);
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const api = makeApi();
    for (const r of [
      await api.deleteApp('shop-api'),
      await api.setScale('shop-api', 0),
      await api.restartApp('shop-api'),
      await api.resizeApp('shop-api', 'plan-big'),
    ]) {
      expect(r).toEqual({ accepted: true });
    }
    expect(seen).toEqual([
      'DELETE shop-api',
      'scale shop-api {"scale":0}',
      'restart shop-api',
      'resize shop-api {"planID":"plan-big"}',
    ]);
  });

  it('levenshtein / closestName', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(closestName('blog-statik', ['shop-api', 'blog-static'])).toBe('blog-static');
    expect(closestName('x', [])).toBeUndefined();
  });
});

describe('waitForState', () => {
  it('resolves once the predicate holds and reports ticks', async () => {
    let n = 0;
    const ticks: number[] = [];
    const v = await waitForState(
      async () => ++n,
      (x) => x >= 3,
      { intervalMs: 10, sleep: async () => {}, onTick: (x) => ticks.push(x) },
    );
    expect(v).toBe(3);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it('times out with WAIT_TIMEOUT and the last value', async () => {
    let t = 0;
    const e = (await waitForState(
      async () => 'pending',
      () => false,
      {
        timeoutMs: 1_000,
        intervalMs: 300,
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      },
    ).catch((x: unknown) => x)) as LiaraApiError;
    expect(e).toBeInstanceOf(LiaraApiError);
    expect(e.code).toBe('WAIT_TIMEOUT');
    expect(e.details.last).toBe('pending');
    expect(t).toBeLessThanOrEqual(1_000);
  });
});

describe('app waiters', () => {
  const fast = { intervalMs: 1, sleep: async () => {} };

  it('waitAppGone polls fresh until the app disappears', async () => {
    let calls = 0;
    serveList(() => {
      calls++;
      const f = fixture();
      return calls < 3 ? f : { projects: f.projects.filter((p) => p.project_id !== 'shop-api') };
    });
    const api = makeApi();
    await waitAppGone(api, 'shop-api', fast);
    expect(calls).toBe(3);
  });

  it('waitAppScale waits for the requested scale', async () => {
    let calls = 0;
    serveList(() => {
      calls++;
      const f = fixture();
      if (calls >= 2) (f.projects[0] as Record<string, unknown>).scale = 0;
      return f;
    });
    const app = await waitAppScale(makeApi(), 'shop-api', 0, fast);
    expect(app.scale).toBe(0);
  });

  it('waitAppRunning requires scale 1, not undeployed, and a passing probe', async () => {
    serveList(fixture);
    let probes = 0;
    const app = await waitAppRunning(makeApi(), 'shop-api', {
      ...fast,
      probe: async () => ++probes >= 2,
    });
    expect(app.name).toBe('shop-api');
    expect(probes).toBe(2);
  });

  it('waitAppRunning never succeeds for an undeployed app', async () => {
    serveList(fixture);
    let t = 0;
    await expect(
      waitAppRunning(makeApi(), 'fresh-app', {
        timeoutMs: 50,
        intervalMs: 10,
        now: () => t,
        sleep: async (ms) => {
          t += ms;
        },
      }),
    ).rejects.toMatchObject({ code: 'WAIT_TIMEOUT' });
  });
});
