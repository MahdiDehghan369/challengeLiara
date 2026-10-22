import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppsApi } from '../../../src/liara/api/apps.js';
import { DisksApi } from '../../../src/liara/api/disks.js';
import { DomainsApi } from '../../../src/liara/api/domains.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { waitAppGone } from '../../../src/liara/wait.js';
import { deleteApp, deleteDatabase, deleteDisk, deleteDomain, deleteFtp } from '../../../src/ops/delete.js';
import { Risk, type ActionPlan } from '../../../src/safety/risk.js';
import { ApprovalDeniedError } from '../../../src/shared/errors.js';
import { CANCELLED, CliApprover, type Prompter, type SelectOption } from '../../../src/ui/cli/approver.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const APP = 'shop-api';
const APP_ID = '64f0000000000000000000a1';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Types the given answer at the R3 prompt; records the card it was shown. */
class TypingPrompter implements Prompter {
  notes: string[] = [];
  constructor(private readonly typed: string) {}
  note(body: string): void {
    this.notes.push(body);
  }
  async select<V extends string>(_m: string, _o: SelectOption<V>[]): Promise<V | typeof CANCELLED> {
    throw new Error('R3 must not offer a select');
  }
  async text(): Promise<string> {
    return this.typed;
  }
}

const sent: string[] = [];
function setup() {
  sent.length = 0;
  let deleted = false;
  server.events.removeAllListeners();
  server.events.on('request:start', ({ request }) => {
    if (request.method !== 'GET') sent.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  server.use(
    http.get(`${BASE}/v1/projects`, () => {
      const list = loadFixture('projects.list.json') as { projects: Array<{ project_id: string }> };
      return HttpResponse.json(deleted ? { projects: list.projects.filter((p) => p.project_id !== APP) } : list);
    }),
    http.get(`${BASE}/v1/projects/${APP_ID}/disks`, () => HttpResponse.json(loadFixture('disks.list.json'))),
    http.get(`${BASE}/v1/projects/${APP}/disks/:disk/ftp`, ({ params }) =>
      HttpResponse.json({ accesses: params.disk === 'uploads' ? [{ _id: 'f1', username: 'ftp-user', password: 'x-ftp-pass' }] : [] }),
    ),
    http.get(`${BASE}/v1/domains`, () => HttpResponse.json({ domains: [{ _id: 'dm1', name: 'shop.example.ir' }] })),
    http.delete(`${BASE}/v1/projects/${APP}`, () => {
      deleted = true;
      return new HttpResponse(null, { status: 200 });
    }),
    http.delete(`${BASE}/v1/projects/${APP_ID}/disks/uploads`, () => new HttpResponse(null, { status: 200 })),
    http.delete(`${BASE}/v1/domains/dm1`, () => new HttpResponse(null, { status: 200 })),
    http.delete(`${BASE}/v1/ftp/ftp-user`, () => new HttpResponse(null, { status: 200 })),
  );
  const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
  const apps = new AppsApi(h);
  const disks = new DisksApi(h, apps);
  const domains = new DomainsApi(h, apps);
  const appBackend = {
    deleteApp: (n: string) => apps.deleteApp(n),
    waitGone: (n: string) => waitAppGone(apps, n, { sleep: async () => {}, intervalMs: 1, timeoutMs: 1000 }),
  };
  return { apps, disks, domains, appBackend };
}

const approverTyping = (typed: string) => {
  const prompter = new TypingPrompter(typed);
  const seen: ActionPlan[] = [];
  const cli = new CliApprover({ prompter, interactive: true, color: false });
  return {
    prompter,
    seen,
    approver: { request: (p: ActionPlan) => (seen.push(p), cli.request(p)) },
  };
};

describe('delete_app (R3)', () => {
  it('card lists all dependents + backup suggestion; correct name → deleted and confirmed gone', async () => {
    const { disks, domains, appBackend, apps } = setup();
    const { approver, seen, prompter } = approverTyping(APP);
    const r = await deleteApp({ apps: appBackend, disks, domains }, APP, { approver });
    expect(r.status).toBe('executed');
    expect(seen[0]?.risk).toBe(Risk.R3);
    const card = prompter.notes.join('\n');
    for (const s of ['uploads', '/app/uploads', 'cache', 'ftp-user', 'shop.example.ir', 'backup', 'دیتابیس']) {
      expect(card).toContain(s);
    }
    expect(card).not.toContain('x-ftp-pass');
    expect(sent).toEqual([`DELETE /v1/projects/${APP}`]);
    expect(await apps.findApp(APP, { fresh: true })).toBeUndefined();
  });

  it('wrong name typed → cancelled, nothing deleted', async () => {
    const { disks, domains, appBackend } = setup();
    const { approver } = approverTyping('shop-ap');
    await expect(deleteApp({ apps: appBackend, disks, domains }, APP, { approver })).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(sent).toEqual([]);
  });
});

describe('other deletes (R3)', () => {
  it('delete_disk: mount + FTP listed, backup suggested; app name required', async () => {
    const { disks } = setup();
    const wrong = approverTyping('uploads');
    await expect(deleteDisk(disks, APP, 'uploads', { approver: wrong.approver })).rejects.toBeInstanceOf(ApprovalDeniedError);
    const ok = approverTyping(APP);
    await deleteDisk(disks, APP, 'uploads', { approver: ok.approver });
    expect(ok.seen[0]?.impactFa).toContain('/app/uploads');
    expect(ok.seen[0]?.impactFa).toContain('ftp-user');
    expect(ok.seen[0]?.impactFa).toContain('backup');
    expect(sent).toEqual([`DELETE /v1/projects/${APP_ID}/disks/uploads`]);
  });

  it('delete_domain without an app: type the domain name', async () => {
    const { domains } = setup();
    const { approver, seen } = approverTyping('shop.example.ir');
    await deleteDomain(domains, { id: 'dm1', name: 'shop.example.ir' }, { approver });
    expect(seen[0]?.risk).toBe(Risk.R3);
    expect(sent).toEqual(['DELETE /v1/domains/dm1']);
  });

  it('delete_database: type the database name; wrong → nothing runs', async () => {
    const removed: string[] = [];
    const db = { dbRemove: async (n: string) => (removed.push(n), { stdout: '', stderr: '', exitCode: 0 }) };
    await expect(deleteDatabase(db, 'shop-db', { approver: approverTyping('shop').approver })).rejects.toBeInstanceOf(
      ApprovalDeniedError,
    );
    const { seen, approver } = approverTyping('shop-db');
    await deleteDatabase(db, 'shop-db', { approver }, { usedBy: ['shop-api'] });
    expect(removed).toEqual(['shop-db']);
    expect(seen[0]?.impactFa).toContain('shop-api');
    expect(seen[0]?.impactFa).toContain('backup');
  });

  it('delete_ftp: R3', async () => {
    const { disks } = setup();
    const { approver, seen } = approverTyping(APP);
    await deleteFtp(disks, { username: 'ftp-user', app: APP }, { approver });
    expect(seen[0]?.risk).toBe(Risk.R3);
    expect(sent).toEqual(['DELETE /v1/ftp/ftp-user']);
  });

  it('cancelled prompt → nothing deleted', async () => {
    const { disks } = setup();
    const prompter: Prompter = { note: () => {}, select: async () => CANCELLED, text: async () => CANCELLED };
    const approver = new CliApprover({ prompter, interactive: true });
    await expect(deleteFtp(disks, { username: 'ftp-user', app: APP }, { approver })).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(sent).toEqual([]);
  });
});
