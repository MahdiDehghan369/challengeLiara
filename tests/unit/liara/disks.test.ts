import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { DisksApi } from '../../../src/liara/api/disks.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import type { LiaraApiError } from '../../../src/shared/errors.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const APP = 'shop-api';
const APP_ID = '64f0000000000000000000a1';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Records every request path so tests can prove `{id}` vs `{name}` usage. */
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
  return new DisksApi(h, new AppsApi(h));
}

describe('DisksApi', () => {
  it('listDisks uses {id} and joins mounts', async () => {
    const api = setup();
    server.use(
      http.get(`${BASE}/v1/projects/${APP_ID}/disks`, () =>
        HttpResponse.json(loadFixture('disks.list.json')),
      ),
    );
    const r = await api.listDisks(APP);
    expect(paths).toEqual([`GET /v1/projects/${APP_ID}/disks`]);
    expect(r.disks).toEqual([
      { id: 'd1', name: 'uploads', size: 1, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-02T10:00:00.000Z', mountedTo: '/app/uploads' },
      { id: 'd2', name: 'cache', size: 2, createdAt: undefined, updatedAt: undefined, mountedTo: undefined },
    ]);
    expect(r.mounts).toEqual([{ name: 'uploads', mountedTo: '/app/uploads' }]);
  });

  it('createDisk/resizeDisk use {name} and send size as string (201 handled)', async () => {
    const api = setup();
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/v1/projects/${APP}/disks`, async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 201 });
      }),
      http.post(`${BASE}/v1/projects/${APP}/disks/uploads/resize`, async ({ request }) => {
        bodies.push(await request.json());
        return new HttpResponse(null, { status: 200 });
      }),
    );
    expect(await api.createDisk(APP, { name: 'uploads', size: 1 })).toEqual({ accepted: true });
    expect(await api.resizeDisk(APP, 'uploads', 2)).toEqual({ accepted: true });
    expect(bodies).toEqual([{ name: 'uploads', size: '1' }, { size: '2' }]);
    expect(paths).toEqual([`POST /v1/projects/${APP}/disks`, `POST /v1/projects/${APP}/disks/uploads/resize`]);
  });

  it('deleteDisk uses {id}; 409 → DISK_IN_USE', async () => {
    const api = setup();
    server.use(
      http.delete(`${BASE}/v1/projects/${APP_ID}/disks/uploads`, () => new HttpResponse(null, { status: 409 })),
      http.delete(`${BASE}/v1/projects/${APP_ID}/disks/cache`, () => new HttpResponse(null, { status: 200 })),
    );
    const e = (await api.deleteDisk(APP, 'uploads').catch((x: unknown) => x)) as LiaraApiError;
    expect(e.code).toBe('DISK_IN_USE');
    expect(e.messageFa).toContain('uploads');
    expect(await api.deleteDisk(APP, 'cache')).toEqual({ accepted: true });
  });

  it('backups: list/create/download all use {id}; link is a Secret', async () => {
    const api = setup();
    server.use(
      http.get(`${BASE}/v1/projects/${APP_ID}/disks/uploads/backups`, () =>
        HttpResponse.json({ backups: [{ name: 'b1', lastModified: '2026-10-01', etag: 'e', size: '1024' }] }),
      ),
      http.post(`${BASE}/v1/projects/${APP_ID}/disks/uploads/backups`, () => new HttpResponse(null, { status: 200 })),
      http.post(`${BASE}/v1/projects/${APP_ID}/disks/uploads/backups/b1/download`, () =>
        HttpResponse.json({ link: 'https://storage.example/b1?X-Signature=abc' }),
      ),
    );
    expect(await api.listBackups(APP, 'uploads')).toEqual([
      { name: 'b1', lastModified: '2026-10-01', etag: 'e', size: 1024 },
    ]);
    await api.createBackup(APP, 'uploads');
    const link = await api.getBackupDownloadLink(APP, 'uploads', 'b1');
    expect(JSON.stringify({ link })).not.toContain('X-Signature');
    expect(link.reveal()).toContain('X-Signature=abc');
    expect(paths.every((p) => p.includes(APP_ID))).toBe(true);
  });

  it('FTP: list/create use {name}; JSON.stringify never leaks passwords', async () => {
    const api = setup();
    server.use(
      http.get(`${BASE}/v1/projects/${APP}/disks/uploads/ftp`, () =>
        HttpResponse.json({
          host: 'ftp.example',
          accesses: [{ _id: 'f1', disk: 'uploads', username: 'u1', password: 'ftp-pass-111', readOnly: true }],
        }),
      ),
      http.post(`${BASE}/v1/projects/${APP}/disks/uploads/ftp`, () =>
        HttpResponse.json({ username: 'u2', password: 'ftp-pass-222', host: 'ftp.example' }),
      ),
      http.delete(`${BASE}/v1/ftp/u2`, () => new HttpResponse(null, { status: 200 })),
    );
    const list = await api.listFtp(APP, 'uploads');
    const created = await api.createFtp(APP, 'uploads', { username: 'u2', readOnly: false });
    const dump = JSON.stringify({ list, created });
    expect(dump).not.toContain('ftp-pass-111');
    expect(dump).not.toContain('ftp-pass-222');
    expect(dump).toContain('[SECRET]');
    expect(created.password.reveal()).toBe('ftp-pass-222');
    expect(await api.deleteFtp('u2')).toEqual({ accepted: true });
    expect(paths).toEqual([
      `GET /v1/projects/${APP}/disks/uploads/ftp`,
      `POST /v1/projects/${APP}/disks/uploads/ftp`,
      'DELETE /v1/ftp/u2',
    ]);
  });
});
