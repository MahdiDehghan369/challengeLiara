import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { DisksApi } from '../../../src/liara/api/disks.js';
import { DomainsApi } from '../../../src/liara/api/domains.js';
import { SettingsApi } from '../../../src/liara/api/settings.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { setDefaultSubdomain, setFixedIp, setReadOnly, setZeroDowntime } from '../../../src/ops/settings.js';
import { ScriptedApprover, YesApprover } from '../../../src/safety/approval.js';
import { Risk } from '../../../src/safety/risk.js';
import { ApprovalDeniedError } from '../../../src/shared/errors.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const APP = 'shop-api';
const APP_ID = '64f0000000000000000000a1';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sent: string[] = [];
function setup(domains: unknown[] = []) {
  sent.length = 0;
  server.events.removeAllListeners();
  server.events.on('request:start', ({ request }) => {
    if (request.method !== 'GET') sent.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  server.use(
    http.get(`${BASE}/v1/projects`, () => HttpResponse.json(loadFixture('projects.list.json'))),
    http.get(`${BASE}/v1/domains`, () => HttpResponse.json({ domains })),
    http.get(`${BASE}/v1/projects/${APP_ID}/disks`, () => HttpResponse.json(loadFixture('disks.list.json'))),
    http.post(`${BASE}/v1/projects/:id/:setting/:status`, ({ params }) =>
      params.setting === 'fixed-ip' ? HttpResponse.json({ IP: '185.0.0.10' }) : new HttpResponse(null, { status: 200 }),
    ),
  );
  const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
  const apps = new AppsApi(h);
  return { settings: new SettingsApi(h, apps), domains: new DomainsApi(h, apps), disks: new DisksApi(h, apps) };
}

describe('settings tools', () => {
  it('set_zero_downtime: R1, plain-language effect, {id} route', async () => {
    const { settings } = setup();
    const approver = new ScriptedApprover(['approved']);
    const r = await setZeroDowntime(settings, APP, true, { approver });
    expect(r.status).toBe('executed');
    const plan = approver.seen[0];
    expect(plan?.risk).toBe(Risk.R1);
    expect(plan?.impactFa).toContain('قطعی');
    expect(plan?.rollbackFa).toContain('غیرفعال');
    expect(sent).toEqual([`POST /v1/projects/${APP_ID}/zero-downtime/enable`]);
  });

  it('set_default_subdomain disable without a custom domain → R2 + "app goes offline" warning', async () => {
    const { settings, domains } = setup([]);
    const approver = new ScriptedApprover(['approved']);
    await setDefaultSubdomain(settings, domains, APP, false, { approver });
    expect(approver.seen[0]?.risk).toBe(Risk.R2);
    expect(approver.seen[0]?.impactFa).toContain('از دسترس خارج');
  });

  it('set_default_subdomain disable with a custom domain → R1, no warning; enable → R1', async () => {
    const { settings, domains } = setup([{ _id: 'dm1', name: 'shop.ir' }]);
    const approver = new ScriptedApprover(['approved', 'approved']);
    await setDefaultSubdomain(settings, domains, APP, false, { approver });
    await setDefaultSubdomain(settings, domains, APP, true, { approver });
    expect(approver.seen.map((p) => p.risk)).toEqual([Risk.R1, Risk.R1]);
    expect(approver.seen[0]?.impactFa).not.toContain('از دسترس خارج');
  });

  it('set_fixed_ip: R2 (cost) — --yes cannot approve it; cost shown when known', async () => {
    const { settings } = setup();
    await expect(setFixedIp(settings, APP, true, { approver: new YesApprover() })).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(sent).toEqual([]);
    const approver = new ScriptedApprover(['approved']);
    const r = await setFixedIp(settings, APP, true, { approver }, { monthlyCostToman: 300000 });
    expect(approver.seen[0]).toMatchObject({ risk: Risk.R2, costToman: { monthly: 300000 } });
    expect(approver.seen[0]?.impactFa).toContain('هزینه');
    expect(r.status === 'executed' && r.result.ip).toBe('185.0.0.10');
  });

  it('set_read_only: R1; warns when the app has mounted disks or writes locally', async () => {
    const { settings, disks } = setup();
    const approver = new ScriptedApprover(['approved', 'approved']);
    await setReadOnly(settings, APP, true, { approver }, { mounts: disks, writesTo: ['/tmp'] });
    expect(approver.seen[0]?.risk).toBe(Risk.R1);
    expect(approver.seen[0]?.impactFa).toContain('/app/uploads');
    expect(approver.seen[0]?.impactFa).toContain('/tmp');
    await setReadOnly(settings, APP, false, { approver }, { mounts: disks });
    expect(approver.seen[1]?.impactFa).not.toContain('هشدار');
  });
});
