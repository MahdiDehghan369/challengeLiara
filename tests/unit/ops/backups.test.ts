import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { DisksApi } from '../../../src/liara/api/disks.js';
import { MetricsApi } from '../../../src/liara/api/metrics.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import {
  backupDownloadLink,
  createBackup,
  createDisk,
  createFtp,
  listDisksWithUsage,
  resizeDisk,
} from '../../../src/ops/backups.js';
import type { OpsContext } from '../../../src/ops/context.js';
import { ScriptedApprover, type ApprovalDecision } from '../../../src/safety/approval.js';
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
function setup(summary: unknown = loadFixture('metrics.summary.json')) {
  sent.length = 0;
  server.events.removeAllListeners();
  server.events.on('request:start', ({ request }) => {
    const u = new URL(request.url);
    if (request.method !== 'GET') sent.push(`${request.method} ${u.pathname}`);
  });
  server.use(
    http.get(`${BASE}/v1/projects`, () => HttpResponse.json(loadFixture('projects.list.json'))),
    http.get(`${BASE}/v1/projects/${APP_ID}/disks`, () => HttpResponse.json(loadFixture('disks.list.json'))),
    http.get(`${BASE}/v1/projects/${APP}/metrics/summary`, () => HttpResponse.json(summary as Record<string, unknown>)),
    http.post(`${BASE}/v1/projects/${APP_ID}/disks/uploads/backups`, () => new HttpResponse(null, { status: 200 })),
    http.post(`${BASE}/v1/projects/${APP_ID}/disks/uploads/backups/b1/download`, () =>
      HttpResponse.json({ link: 'https://storage.example/b1?X-Signature=abc' }),
    ),
    http.post(`${BASE}/v1/projects/${APP}/disks/uploads/resize`, () => new HttpResponse(null, { status: 200 })),
    http.post(`${BASE}/v1/projects/${APP}/disks`, () => new HttpResponse(null, { status: 201 })),
    http.post(`${BASE}/v1/projects/${APP}/disks/uploads/ftp`, () =>
      HttpResponse.json({ username: 'u2', password: 'ftp-pass-222', host: 'ftp.example' }),
    ),
  );
  const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
  return { disks: new DisksApi(h, new AppsApi(h)), metrics: new MetricsApi(h) };
}

const ctx = (decisions: ApprovalDecision[]) => {
  const approver = new ScriptedApprover(decisions);
  return { approver, ctx: { approver } satisfies OpsContext };
};

describe('list_disks (R0)', () => {
  it('joins usage percent from the summary; no warning at 25%', async () => {
    const { disks, metrics } = setup();
    const r = await listDisksWithUsage(disks, metrics, APP);
    expect(r.disks.map((d) => [d.name, d.mountedTo, d.usagePercent])).toEqual([
      ['uploads', '/app/uploads', 25],
      ['cache', undefined, undefined],
    ]);
    expect(r.warningsFa).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('warns above 80%', async () => {
    const { disks, metrics } = setup({
      cpuUsage: [],
      memoryUsage: [],
      disksUsage: [{ name: 'uploads', size: '10', usage: '8.7' }],
    });
    const r = await listDisksWithUsage(disks, metrics, APP);
    expect(r.disks[0]?.usagePercent).toBe(87);
    expect(r.warningsFa).toHaveLength(1);
    expect(r.warningsFa[0]).toContain('uploads');
    expect(r.warningsFa[0]).toContain('87');
  });

  it('works without metrics', async () => {
    const { disks } = setup();
    expect((await listDisksWithUsage(disks, undefined, APP)).disks[0]?.usagePercent).toBeUndefined();
  });
});

describe('backup actions', () => {
  it('create_backup is R1 and goes through the gate', async () => {
    const { disks } = setup();
    const { approver, ctx: c } = ctx(['approved']);
    const r = await createBackup(disks, APP, 'uploads', c);
    expect(r.status).toBe('executed');
    expect(approver.seen[0]?.risk).toBe(Risk.R1);
    expect(sent).toEqual([`POST /v1/projects/${APP_ID}/disks/uploads/backups`]);
  });

  it('backup_download_link (R1): the link stays a Secret (never in JSON for the LLM)', async () => {
    const { disks } = setup();
    const r = await backupDownloadLink(disks, APP, 'uploads', 'b1', ctx(['approved']).ctx);
    expect(r.status).toBe('executed');
    if (r.status !== 'executed') return;
    expect(JSON.stringify(r)).not.toContain('X-Signature');
    expect(r.result.reveal()).toContain('X-Signature=abc');
  });
});

describe('R2 disk actions', () => {
  it('resize_disk: R2 with a backup suggestion shown before approval', async () => {
    const { disks } = setup();
    const { approver, ctx: c } = ctx(['approved']);
    await resizeDisk(disks, APP, 'uploads', 5, c);
    expect(approver.seen[0]?.risk).toBe(Risk.R2);
    expect(approver.seen[0]?.impactFa).toContain('backup');
    expect(sent).toEqual([`POST /v1/projects/${APP}/disks/uploads/resize`]);
  });

  it('create_ftp: R2, backup suggestion, password is a Secret', async () => {
    const { disks } = setup();
    const { approver, ctx: c } = ctx(['approved']);
    const r = await createFtp(disks, APP, 'uploads', { username: 'u2', readOnly: true }, c);
    expect(approver.seen[0]?.risk).toBe(Risk.R2);
    expect(approver.seen[0]?.impactFa).toContain('backup');
    expect(JSON.stringify(r)).not.toContain('ftp-pass-222');
    if (r.status === 'executed') expect(r.result.password.reveal()).toBe('ftp-pass-222');
  });

  it('create_disk: R2; denied → nothing sent', async () => {
    const { disks } = setup();
    const { approver, ctx: c } = ctx(['denied']);
    await expect(createDisk(disks, APP, { name: 'media', sizeGb: 2 }, c)).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(approver.seen[0]?.risk).toBe(Risk.R2);
    expect(sent).toEqual([]);
  });

  it('--yes style approvers cannot pass R2 disk actions', async () => {
    const { disks } = setup();
    const { YesApprover } = await import('../../../src/safety/approval.js');
    await expect(resizeDisk(disks, APP, 'uploads', 5, { approver: new YesApprover() })).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(sent).toEqual([]);
  });
});
