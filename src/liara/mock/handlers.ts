import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import { randomBytes } from 'node:crypto';
import { MOCK_PLANS, type MockApp, type MockLiaraState } from './state.js';

/**
 * msw handlers for every `source=map` route in docs/liara/ENDPOINTS.md, backed by `MockLiaraState`.
 * Patterns start with `*` so any base URL works. Usable with `setupServer(...)` in tests or, at
 * runtime (LIARA_MODE=mock), through `createMockFetch` as `LiaraHttp`'s `fetchImpl`.
 */

const notFound = (what = 'App does not exists.') => HttpResponse.json({ message: what }, { status: 404 });
const accepted = () => HttpResponse.json({ message: 'accepted' });

function authed(request: Request): boolean {
  const h = request.headers.get('authorization') ?? '';
  return /^Bearer\s+\S+/.test(h);
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return ((await request.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

function sinceToMs(raw: string | null, now: number): number {
  if (!raw) return now - 3_600_000;
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return n > 1e12 ? n : n > 1e9 ? n * 1000 : now - n * 1000;
  }
  const t = Date.parse(raw);
  return Number.isNaN(t) ? now - 3_600_000 : t;
}

function projectRaw(a: MockApp) {
  return {
    _id: a.id,
    project_id: a.name,
    type: a.platform,
    status: a.status,
    scale: a.scale,
    planID: a.planID,
    bundlePlanID: 'standard',
    created_at: a.createdAt,
    isDeployed: a.isDeployed,
  };
}

const SETTINGS = ['zero-downtime', 'default-subdomain', 'fixed-ip', 'read-only'] as const;

export function createHandlers(state: MockLiaraState): HttpHandler[] {
  const app = (nameOrId: unknown) => state.find(String(nameOrId));
  const series = (a: MockApp, kind: string, sinceRaw: string | null) => {
    const now = state.now();
    const from = sinceToMs(sinceRaw, now);
    const step = Math.max(60_000, Math.floor((now - from) / 60));
    const values: Array<[number, string]> = [];
    for (let t = from; t <= now; t += step) {
      const m = state.metricAt(a, t);
      const v = kind === 'cpu' ? m.cpu : kind === 'memory' ? m.memBytes : kind === 'network-receive' ? m.rx : m.tx;
      values.push([Math.floor(t / 1000), String(v)]);
    }
    return { end: Math.floor(now / 1000), result: [{ applet: `${a.name}-7c9d8f-mock1`, values }] };
  };

  return [
    // ---- auth gate: everything requires a bearer token
    ...['*/v1/*', '*/v2/*'].map((p) =>
      http.all(p, ({ request }) => (authed(request) ? undefined : HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }))),
    ),

    // ---- apps
    http.get('*/v1/projects', () => HttpResponse.json({ projects: [...state.apps.values()].map(projectRaw) })),
    http.post('*/v1/projects', async ({ request }) => {
      const b = await jsonBody(request);
      const name = String(b.name ?? '');
      if (!name || !b.planID || !b.platform) return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      if (state.apps.has(name)) return HttpResponse.json({ message: 'App name already exists.' }, { status: 409 });
      state.createApp({ name, planID: String(b.planID), platform: String(b.platform), readOnly: b.readOnlyRootFilesystem === true });
      return HttpResponse.json({ message: 'project created' });
    }),
    http.post('*/v1/projects/update-envs', async ({ request }) => {
      const b = await jsonBody(request);
      const a = app(b.project);
      if (!a) return notFound();
      const vars = Array.isArray(b.variables) ? (b.variables as Array<{ key: string; value: string }>) : [];
      state.updateEnvs(a, vars.map((v) => ({ key: String(v.key), value: String(v.value) })));
      return HttpResponse.json({ message: 'environment variables updated' });
    }),
    http.delete('*/v1/projects/:name', ({ params }) => {
      const a = app(params.name);
      if (!a) return notFound();
      state.deleteApp(a);
      return accepted();
    }),
    http.post('*/v1/projects/:name/actions/scale', async ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const scale = Number((await jsonBody(request)).scale);
      if (scale !== 0 && scale !== 1) return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      state.setScale(a, scale);
      return accepted();
    }),
    http.post('*/v1/projects/:name/actions/restart', ({ params }) => {
      const a = app(params.name);
      if (!a) return notFound();
      state.restart(a);
      return accepted();
    }),
    http.post('*/v1/projects/:name/resize', async ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const planID = String((await jsonBody(request)).planID ?? '');
      if (!MOCK_PLANS.some((p) => p.Plan === planID)) return HttpResponse.json({ message: 'Invalid plan' }, { status: 400 });
      state.resize(a, planID);
      return accepted();
    }),

    // ---- logs / events / metrics
    http.get('*/v1/projects/:name/logs', ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const since = sinceToMs(new URL(request.url).searchParams.get('since'), state.now());
      return HttpResponse.json(
        a.logs.filter((l) => l.ts >= since).map((l) => ({ type: l.type, datetime: new Date(l.ts).toISOString(), message: l.message })),
      );
    }),
    http.get('*/v1/projects/:name/events', ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const q = new URL(request.url).searchParams;
      const start = q.get('start') ? Number(q.get('start')) * 1000 : 0;
      const end = q.get('end') ? Number(q.get('end')) * 1000 : Infinity;
      const search = (q.get('search') ?? '').toLowerCase();
      const values = a.events
        .filter((e) => e.ts >= start && e.ts <= end && (!search || e.text.toLowerCase().includes(search)))
        .map((e) => [String(Math.floor(e.ts / 1000)), e.text]);
      return HttpResponse.json({ data: [{ metaData: { project: a.name }, values }] });
    }),
    http.get('*/v1/projects/:name/metrics/summary', ({ params }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const m = state.metricAt(a, state.now());
      const ts = Math.floor(state.now() / 1000);
      return HttpResponse.json({
        cpuUsage: [{ value: [ts, String(m.cpu)], applet: `${a.name}-7c9d8f-mock1` }],
        memoryUsage: [{ value: [ts, String(m.memBytes)], applet: `${a.name}-7c9d8f-mock1` }],
        disksUsage: a.disks.map((d) => ({ name: d.name, size: String(d.size), usage: String(d.usage), reportedAt: new Date(state.now()).toISOString() })),
      });
    }),
    http.get('*/v1/projects/:name/metrics/:kind', ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const kind = String(params.kind);
      if (!['cpu', 'memory', 'network-receive', 'network-transmit'].includes(kind)) return notFound('Unknown metric');
      return HttpResponse.json(series(a, kind, new URL(request.url).searchParams.get('since')));
    }),

    // ---- deploy (v2)
    http.post('*/v2/projects/:name/sources', async ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const size = (await request.arrayBuffer()).byteLength;
      if (size === 0) return HttpResponse.json({ message: 'file is required' }, { status: 400 });
      return HttpResponse.json({ sourceID: state.addSource(a, size) });
    }),
    http.post('*/v2/projects/:name/releases', async ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const b = await jsonBody(request);
      const sourceID = String(b.sourceID ?? '');
      if (!a.sources.has(sourceID)) return HttpResponse.json({ message: 'source not found' }, { status: 400 });
      const r = state.createRelease(a, { sourceID, port: Number(b.port ?? 3000), type: String(b.type ?? a.platform) }, 'api');
      return HttpResponse.json({ releaseID: r.id });
    }),

    // ---- settings ({id})
    http.post('*/v1/projects/:id/:setting/:status', ({ params }) => {
      const a = state.findById(String(params.id));
      if (!a) return notFound();
      const setting = String(params.setting) as (typeof SETTINGS)[number];
      if (!SETTINGS.includes(setting)) return notFound('Not found');
      const on = params.status === 'enable';
      if (params.status !== 'enable' && params.status !== 'disable') return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      const s = a.settings;
      if (setting === 'fixed-ip') {
        if (on === !!s.fixedIp) return new HttpResponse(null, { status: 409 });
        s.fixedIp = on ? `185.0.0.${1 + (a.id.charCodeAt(0) % 200)}` : undefined;
        return on ? HttpResponse.json({ IP: s.fixedIp }) : accepted();
      }
      const key = setting === 'zero-downtime' ? 'zeroDowntime' : setting === 'default-subdomain' ? 'defaultSubdomain' : 'readOnly';
      if (s[key] === on) return new HttpResponse(null, { status: 409 });
      s[key] = on;
      return accepted();
    }),

    // ---- disks / backups / ftp
    http.get('*/v1/projects/:id/disks', ({ params }) => {
      const a = state.findById(String(params.id));
      if (!a) return notFound();
      return HttpResponse.json({
        disks: a.disks.map((d) => ({ _id: d._id, name: d.name, size: d.size, createdAt: d.createdAt, updatedAt: d.createdAt })),
        mounts: a.disks.filter((d) => d.mountedTo).map((d) => ({ name: d.name, mountedTo: d.mountedTo })),
      });
    }),
    http.post('*/v1/projects/:name/disks', async ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const b = await jsonBody(request);
      const name = String(b.name ?? '');
      if (!name || a.disks.some((d) => d.name === name)) return HttpResponse.json({ message: 'Conflict' }, { status: 409 });
      a.disks.push({ _id: randomBytes(12).toString('hex'), name, size: Number(b.size ?? 1), usage: 0, createdAt: new Date(state.now()).toISOString() });
      return HttpResponse.json({ message: 'disk created' }, { status: 201 });
    }),
    http.post('*/v1/projects/:name/disks/:disk/resize', async ({ params, request }) => {
      const a = app(params.name);
      const d = a?.disks.find((x) => x.name === params.disk);
      if (!a || !d) return notFound('Disk not found');
      state.resizeDisk(a, d, Number((await jsonBody(request)).size ?? d.size));
      return accepted();
    }),
    http.delete('*/v1/projects/:id/disks/:disk', ({ params }) => {
      const a = state.findById(String(params.id));
      const i = a?.disks.findIndex((x) => x.name === params.disk) ?? -1;
      if (!a || i < 0) return notFound('Disk not found');
      if (a.disks[i]?.mountedTo && a.scale === 1) return HttpResponse.json({ message: 'Disk is in use' }, { status: 409 });
      a.disks.splice(i, 1);
      return accepted();
    }),
    http.get('*/v1/projects/:id/disks/:disk/backups', ({ params }) => {
      const a = state.findById(String(params.id));
      if (!a) return notFound();
      return HttpResponse.json({ backups: a.backups.get(String(params.disk)) ?? [] });
    }),
    http.post('*/v1/projects/:id/disks/:disk/backups', ({ params }) => {
      const a = state.findById(String(params.id));
      const d = a?.disks.find((x) => x.name === params.disk);
      if (!a || !d) return notFound('Disk not found');
      const list = a.backups.get(d.name) ?? [];
      list.push({ name: `backup-${list.length + 1}`, lastModified: new Date(state.now()).toISOString(), etag: randomBytes(8).toString('hex'), size: Math.round(d.usage * 1024 ** 3) });
      a.backups.set(d.name, list);
      return accepted();
    }),
    http.post('*/v1/projects/:id/disks/:disk/backups/:backup/download', ({ params }) => {
      const a = state.findById(String(params.id));
      if (!a?.backups.get(String(params.disk))?.some((b) => b.name === params.backup)) return notFound('Backup not found');
      return HttpResponse.json({ link: `https://storage.mock.liara.invalid/${params.backup}?X-Signature=${randomBytes(8).toString('hex')}` });
    }),
    http.get('*/v1/projects/:name/disks/:disk/ftp', ({ params }) => {
      const a = app(params.name);
      if (!a) return notFound();
      return HttpResponse.json({
        host: 'ftp.mock.liara.invalid',
        accesses: a.ftp.filter((f) => f.disk === params.disk).map((f) => ({ _id: f._id, disk: f.disk, username: f.username, password: f.password, readOnly: f.readOnly })),
      });
    }),
    http.post('*/v1/projects/:name/disks/:disk/ftp', async ({ params, request }) => {
      const a = app(params.name);
      if (!a) return notFound();
      const b = await jsonBody(request);
      const f = { _id: randomBytes(12).toString('hex'), username: String(b.username ?? `ftp-${randomBytes(3).toString('hex')}`), password: randomBytes(9).toString('base64url'), readOnly: b.readOnly !== false, disk: String(params.disk) };
      a.ftp.push(f);
      return HttpResponse.json({ username: f.username, password: f.password, host: 'ftp.mock.liara.invalid' });
    }),
    http.delete('*/v1/ftp/:fname', ({ params }) => {
      for (const a of state.apps.values()) {
        const i = a.ftp.findIndex((f) => f.username === params.fname);
        if (i >= 0) {
          a.ftp.splice(i, 1);
          return accepted();
        }
      }
      return notFound('FTP access not found');
    }),

    // ---- domains / ssl
    http.get('*/v1/domains', ({ request }) => {
      const project = new URL(request.url).searchParams.get('project');
      return HttpResponse.json({ domains: state.domains.filter((d) => !project || d.project === project) });
    }),
    http.post('*/v1/domains/set-project', async ({ request }) => {
      const b = await jsonBody(request);
      const d = state.domains.find((x) => x._id === b.domainID);
      const a = state.findById(String(b.projectID));
      if (!d || !a) return notFound('Domain or app not found');
      d.project = a.name;
      d.status = 'CONNECTED';
      return accepted();
    }),
    http.post('*/v1/domains/provision-ssl-certs', async ({ request }) => {
      const body = await jsonBody(request);
      const d = state.domains.find((x) => x.name === body.domain);
      if (!d) return notFound('Domain not found');
      d.certificatesStatus = 'ACTIVE';
      return HttpResponse.json({ code: 'ssl_provisioning_started' });
    }),
    http.post('*/v1/domains', async ({ request }) => {
      const b = await jsonBody(request);
      const name = String(b.name ?? '');
      if (!name) return HttpResponse.json({ message: 'Bad request' }, { status: 400 });
      if (state.domains.some((d) => d.name === name)) return HttpResponse.json({ message: 'Domain exists' }, { status: 409 });
      const project = b.project ? String(b.project) : undefined;
      const d = {
        _id: randomBytes(12).toString('hex'),
        name,
        type: String(b.type ?? 'PROJECT'),
        project,
        status: 'PENDING',
        certificatesStatus: 'INACTIVE',
        redirectTo: null,
        redirectStatus: null,
        created_at: new Date(state.now()).toISOString(),
        CNameRecord: `${project ?? 'app'}.liara.run`,
      };
      state.domains.push(d);
      return HttpResponse.json({ domain: { _id: d._id } }, { status: 201 });
    }),
    http.post('*/v1/domains/:id/set-redirect', async ({ params, request }) => {
      const d = state.domains.find((x) => x._id === params.id);
      if (!d) return notFound('Domain not found');
      const b = await jsonBody(request);
      d.redirectStatus = Number(b.redirectStatus);
      d.redirectTo = String(b.redirectTo ?? '');
      return accepted();
    }),
    http.post('*/v1/domains/:id/ssl/disable', ({ params }) => {
      const d = state.domains.find((x) => x._id === params.id);
      if (!d) return notFound('Domain not found');
      d.certificatesStatus = 'INACTIVE';
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('*/v1/domains/:id', ({ params }) => {
      const i = state.domains.findIndex((x) => x._id === params.id);
      if (i < 0) return notFound('Domain not found');
      state.domains.splice(i, 1);
      return accepted();
    }),

    // ---- billing
    http.get('*/v1/billing', () => HttpResponse.json({ user: { ...state.billing } })),
  ];
}

/** A `fetch` for `LiaraHttp` that answers from the mock (no network). Unknown routes → 404. */
export function createMockFetch(state: MockLiaraState): typeof fetch {
  const handlers = createHandlers(state);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const res = await getResponse(handlers, request);
    return res ?? HttpResponse.json({ message: 'Not found (mock)' }, { status: 404 });
  }) as typeof fetch;
}
