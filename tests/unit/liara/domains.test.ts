import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { DomainsApi } from '../../../src/liara/api/domains.js';
import { dnsMatches, resolveA, resolveCname, zoneCheck, type DnsResolver } from '../../../src/liara/dns.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { ExternalCommandError, type LiaraApiError } from '../../../src/shared/errors.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const APP = 'shop-api';
const APP_ID = '64f0000000000000000000a1';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const calls: Array<{ method: string; path: string; body?: unknown }> = [];
function setup() {
  calls.length = 0;
  server.events.removeAllListeners();
  server.events.on('request:start', async ({ request }) => {
    const u = new URL(request.url);
    if (u.pathname === '/v1/projects') return;
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text();
    calls.push({ method: request.method, path: `${u.pathname}${u.search}`, ...(text ? { body: JSON.parse(text) } : {}) });
  });
  server.use(http.get(`${BASE}/v1/projects`, () => HttpResponse.json(loadFixture('projects.list.json'))));
  const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
  return new DomainsApi(h, new AppsApi(h));
}

describe('DomainsApi', () => {
  it('listDomains: ?project=<name>, normalized', async () => {
    const api = setup();
    server.use(
      http.get(`${BASE}/v1/domains`, () =>
        HttpResponse.json({
          domains: [
            {
              _id: 'dm1',
              name: 'shop.example.ir',
              type: 'PROJECT',
              project: { project_id: APP },
              status: 'CONNECTED',
              certificatesStatus: 'ACTIVE',
              redirectTo: null,
              redirectStatus: null,
              created_at: '2026-10-01T00:00:00Z',
              CNameRecord: 'shop-api.liara.run',
            },
          ],
        }),
      ),
    );
    expect(await api.listDomains(APP)).toEqual([
      {
        id: 'dm1',
        name: 'shop.example.ir',
        type: 'PROJECT',
        status: 'CONNECTED',
        certificatesStatus: 'ACTIVE',
        redirectTo: undefined,
        redirectStatus: undefined,
        createdAt: '2026-10-01T00:00:00Z',
        cnameRecord: 'shop-api.liara.run',
      },
    ]);
    expect(calls).toEqual([{ method: 'GET', path: `/v1/domains?project=${APP}` }]);
  });

  it('createDomain: 201 handled, default type PROJECT; 409 → DOMAIN_EXISTS', async () => {
    const api = setup();
    server.use(
      http.post(`${BASE}/v1/domains`, async ({ request }) => {
        const b = (await request.json()) as { name: string };
        return b.name === 'taken.ir'
          ? new HttpResponse(null, { status: 409 })
          : HttpResponse.json({ domain: { _id: 'dm2' } }, { status: 201 });
      }),
    );
    expect(await api.createDomain('new.ir', APP)).toEqual({ id: 'dm2' });
    expect(calls[0]).toEqual({ method: 'POST', path: '/v1/domains', body: { name: 'new.ir', project: APP, type: 'PROJECT' } });
    const e = (await api.createDomain('taken.ir', APP).catch((x: unknown) => x)) as LiaraApiError;
    expect(e.code).toBe('DOMAIN_EXISTS');
    expect(e.messageFa).toContain('taken.ir');
  });

  it('attach / redirect / ssl enable / ssl disable (204) / delete', async () => {
    const api = setup();
    server.use(
      http.post(`${BASE}/v1/domains/set-project`, () => new HttpResponse(null, { status: 200 })),
      http.post(`${BASE}/v1/domains/dm1/set-redirect`, () => new HttpResponse(null, { status: 200 })),
      http.post(`${BASE}/v1/domains/provision-ssl-certs`, () => HttpResponse.json({ code: 'ssl_requested' })),
      http.post(`${BASE}/v1/domains/dm1/ssl/disable`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/v1/domains/dm1`, () => new HttpResponse(null, { status: 200 })),
    );
    expect(await api.attachDomainToApp('dm1', APP)).toEqual({ accepted: true });
    expect(await api.setRedirect('dm1', 301, 'https://www.shop.ir')).toEqual({ accepted: true });
    expect(await api.enableSsl('shop.example.ir')).toEqual({ accepted: true, code: 'ssl_requested' });
    expect(await api.disableSsl('dm1')).toEqual({ accepted: true });
    expect(await api.deleteDomain('dm1')).toEqual({ accepted: true });
    expect(calls).toEqual([
      { method: 'POST', path: '/v1/domains/set-project', body: { domainID: 'dm1', projectID: APP_ID } },
      { method: 'POST', path: '/v1/domains/dm1/set-redirect', body: { redirectStatus: 301, redirectTo: 'https://www.shop.ir' } },
      { method: 'POST', path: '/v1/domains/provision-ssl-certs', body: { domain: 'shop.example.ir' } },
      { method: 'POST', path: '/v1/domains/dm1/ssl/disable' },
      { method: 'DELETE', path: '/v1/domains/dm1' },
    ]);
  });
});

const err = (code: string) => Object.assign(new Error(code), { code });

function fakeResolver(cname: Record<string, string[]>, a: Record<string, string[]>): DnsResolver {
  return {
    resolveCname: async (h) => {
      if (h === 'broken.ir') throw err('ETIMEOUT');
      if (!cname[h]) throw err('ENODATA');
      return cname[h];
    },
    resolve4: async (h) => {
      if (!a[h]) throw err('ENOTFOUND');
      return a[h];
    },
  };
}

describe('dns', () => {
  const resolver = fakeResolver(
    { 'www.shop.ir': ['Shop-API.liara.run.'] },
    { 'shop.ir': ['185.0.0.10'], 'www.shop.ir': ['185.0.0.99'] },
  );

  it('resolveCname / resolveA normalize; no record → []', async () => {
    expect(await resolveCname('WWW.shop.ir.', resolver)).toEqual(['shop-api.liara.run']);
    expect(await resolveCname('shop.ir', resolver)).toEqual([]);
    expect(await resolveA('nope.ir', resolver)).toEqual([]);
    await expect(resolveCname('broken.ir', resolver)).rejects.toThrow('ETIMEOUT');
  });

  it('dnsMatches: CNAME, A, mismatch', async () => {
    expect(await dnsMatches('www.shop.ir', { cname: 'shop-api.liara.run' }, resolver)).toEqual({
      matches: true,
      actual: { cname: ['shop-api.liara.run'], a: ['185.0.0.99'] },
    });
    expect((await dnsMatches('shop.ir', { a: ['185.0.0.10'] }, resolver)).matches).toBe(true);
    expect((await dnsMatches('shop.ir', { cname: 'shop-api.liara.run' }, resolver)).matches).toBe(false);
    expect((await dnsMatches('www.shop.ir', { cname: 'other.liara.run', a: ['1.1.1.1'] }, resolver)).matches).toBe(false);
    expect((await dnsMatches('www.shop.ir', {}, resolver)).matches).toBe(false);
  });

  it('zoneCheck: ok / failure tail', async () => {
    const ok = await zoneCheck({ zoneCheck: async () => ({ stdout: 'zone is active', stderr: '', exitCode: 0 }) }, 'Shop.ir.');
    expect(ok).toEqual({ ok: true, output: 'zone is active' });
    const bad = await zoneCheck(
      {
        zoneCheck: async () => {
          throw new ExternalCommandError('liara zone exited with 1', { exitCode: 1, details: { tail: ['NS records not set'] } });
        },
      },
      'shop.ir',
    );
    expect(bad).toEqual({ ok: false, output: 'NS records not set' });
  });
});
