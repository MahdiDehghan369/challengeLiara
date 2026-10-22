import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AccountApi } from '../../../src/liara/api/account.js';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { BillingApi } from '../../../src/liara/api/billing.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { ValidationError } from '../../../src/shared/errors.js';
import { loadFixture, loadRecorded } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const h = () => new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {}, maxRetries: 0 });
const billingReturns = (body: Record<string, unknown>) => server.use(http.get(`${BASE}/v1/billing`, () => HttpResponse.json(body)));

describe('BillingApi.getBilling', () => {
  it('recorded fixture → team scope, balance a number in Toman', async () => {
    billingReturns(loadRecorded('billing.json'));
    const b = await new BillingApi(h()).getBilling();
    expect(b).toEqual({
      balanceToman: 1_000_000,
      accountType: 'REAL_PERSON',
      minCreditThreshold: 20000,
      alertEnabled: true,
      manualThreshold: false,
      lastNotifiedAt: undefined,
      scope: 'team',
    });
    expect((await new BillingApi(h()).getBilling({ scope: 'user' })).scope).toBe('user');
  });

  it('user only; string balances with commas are coerced; spec field minCreditLastNotifiedAt kept', async () => {
    billingReturns({
      user: { balance: '1,250,000.5', accountType: 'LEGAL', minCreditAmount: '0', isManualMinCredit: true, minCreditLastNotifiedAt: '2026-10-01T00:00:00Z' },
    });
    const b = await new BillingApi(h()).getBilling();
    expect(b).toMatchObject({ balanceToman: 1250000.5, scope: 'user', alertEnabled: false, lastNotifiedAt: '2026-10-01T00:00:00Z' });
    expect(typeof b.balanceToman).toBe('number');
  });

  it('non-numeric balance → ValidationError (never NaN)', async () => {
    billingReturns({ user: { balance: 'n/a' } });
    await expect(new BillingApi(h()).getBilling()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('AccountApi.getMe', () => {
  it('valid token → app count via GET /v1/projects', async () => {
    server.use(http.get(`${BASE}/v1/projects`, () => HttpResponse.json(loadFixture('projects.list.json'))));
    const me = await new AccountApi(new AppsApi(h())).getMe();
    expect(me.tokenValid).toBe(true);
    expect(me.appCount).toBeGreaterThan(0);
  });

  it('401 → tokenValid false; other errors propagate', async () => {
    server.use(http.get(`${BASE}/v1/projects`, () => new HttpResponse(null, { status: 401 })));
    expect(await new AccountApi(new AppsApi(h())).getMe()).toEqual({ tokenValid: false, appCount: undefined });
    server.use(http.get(`${BASE}/v1/projects`, () => new HttpResponse(null, { status: 400 })));
    await expect(new AccountApi(new AppsApi(h())).getMe()).rejects.toThrow();
  });
});
