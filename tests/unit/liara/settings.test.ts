import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { SettingsApi } from '../../../src/liara/api/settings.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { LiaraApiError } from '../../../src/shared/errors.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const APP = 'shop-api';
const APP_ID = '64f0000000000000000000a1';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const paths: string[] = [];
function setup() {
  paths.length = 0;
  server.events.removeAllListeners();
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    if (u.pathname !== '/v1/projects') paths.push(`${request.method} ${u.pathname}`);
  });
  server.use(http.get(`${BASE}/v1/projects`, () => HttpResponse.json(loadFixture('projects.list.json'))));
  const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
  return new SettingsApi(h, new AppsApi(h));
}

describe('SettingsApi', () => {
  it('every setting is called with {id}, never with the name', async () => {
    const api = setup();
    server.use(
      http.post(`${BASE}/v1/projects/:id/:setting/:status`, ({ params }) =>
        params.setting === 'fixed-ip' && params.status === 'enable'
          ? HttpResponse.json({ IP: '185.0.0.10' })
          : new HttpResponse(null, { status: 200 }),
      ),
    );
    expect(await api.setZeroDowntime(APP, true)).toEqual({ accepted: true, alreadyInState: false });
    expect(await api.setDefaultSubdomain(APP, false)).toEqual({ accepted: true, alreadyInState: false });
    expect(await api.setFixedIp(APP, true)).toEqual({ accepted: true, alreadyInState: false, ip: '185.0.0.10' });
    expect(await api.setFixedIp(APP, false)).toEqual({ accepted: true, alreadyInState: false, ip: undefined });
    expect(await api.setReadOnly(APP, true)).toEqual({ accepted: true, alreadyInState: false });
    expect(paths).toEqual([
      `POST /v1/projects/${APP_ID}/zero-downtime/enable`,
      `POST /v1/projects/${APP_ID}/default-subdomain/disable`,
      `POST /v1/projects/${APP_ID}/fixed-ip/enable`,
      `POST /v1/projects/${APP_ID}/fixed-ip/disable`,
      `POST /v1/projects/${APP_ID}/read-only/enable`,
    ]);
    expect(paths.some((p) => p.includes(`/${APP}/`))).toBe(false);
  });

  it('409 (already in that state) counts as success with alreadyInState', async () => {
    const api = setup();
    server.use(http.post(`${BASE}/v1/projects/:id/:setting/:status`, () => new HttpResponse(null, { status: 409 })));
    expect(await api.setZeroDowntime(APP, true)).toEqual({ accepted: true, alreadyInState: true });
    expect(await api.setFixedIp(APP, true)).toEqual({ accepted: true, alreadyInState: true, ip: undefined });
  });

  it('other errors propagate', async () => {
    const api = setup();
    server.use(http.post(`${BASE}/v1/projects/:id/:setting/:status`, () => new HttpResponse(null, { status: 400 })));
    await expect(api.setReadOnly(APP, true)).rejects.toBeInstanceOf(LiaraApiError);
  });

  it('unknown app → resolveApp error, no settings call', async () => {
    const api = setup();
    await expect(api.setReadOnly('no-such-app', true)).rejects.toThrow();
    expect(paths).toEqual([]);
  });
});
