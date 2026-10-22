/**
 * T0.5 — records real Liara responses as fixtures. READ-ONLY: only GET requests and list commands.
 *
 *   pnpm tsx scripts/record-fixtures.ts --app none        # app-independent fixtures only
 *   pnpm tsx scripts/record-fixtures.ts --app <name>      # + app-specific fixtures
 *
 * Needs LIARA_API_TOKEN (and optionally LIARA_TEAM_ID) in .env; never printed. Every response is
 * redacted before it is written to fixtures/liara/recorded/, then the folder is secret-scanned.
 * A failing call is recorded as `<name>.error.json` (status + code only) instead of aborting.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import { LiaraCli } from '../src/liara/cli.js';
import { LiaraHttp } from '../src/liara/http.js';
import { isSiavashError } from '../src/shared/errors.js';
import { findSecrets } from './check-secrets.js';
import { envSecrets, redactFixture } from './redact-fixture.js';

const OUT = join('fixtures', 'liara', 'recorded');

dotenv.config({ quiet: true });
const token = process.env.LIARA_API_TOKEN?.trim() ?? '';
const teamId = process.env.LIARA_TEAM_ID?.trim() || undefined;
if (!token) {
  console.error('LIARA_API_TOKEN is not set (.env). Aborting.');
  process.exit(1);
}
const argApp = process.argv.indexOf('--app');
const app = argApp > -1 ? process.argv[argApp + 1] : undefined;
if (!app) {
  console.error('usage: record-fixtures.ts --app <name|none>');
  process.exit(2);
}

const secrets = envSecrets();
const http = new LiaraHttp({ token, teamId, maxRetries: 1 });
const cli = new LiaraCli({ token, teamId });
mkdirSync(OUT, { recursive: true });

const summary: Array<{ name: string; ok: boolean; note: string }> = [];

function write(name: string, data: unknown): void {
  writeFileSync(join(OUT, name), `${JSON.stringify(redactFixture(data, { knownSecrets: secrets }), null, 2)}\n`, 'utf8');
}

async function record(name: string, fn: () => Promise<unknown>): Promise<unknown> {
  try {
    const data = await fn();
    write(`${name}.json`, data);
    summary.push({ name, ok: true, note: Array.isArray(data) ? `array(${data.length})` : typeof data });
    return data;
  } catch (e) {
    const err = isSiavashError(e)
      ? { error: e.name, code: e.code, status: (e as { status?: number }).status ?? null, details: e.details }
      : { error: e instanceof Error ? e.name : 'Error', message: e instanceof Error ? e.message : String(e) };
    write(`${name}.error.json`, err);
    summary.push({ name, ok: false, note: `${err.error}${'code' in err ? ` ${String(err.code)}` : ''}` });
    return undefined;
  }
}

const get = (path: string, query?: Record<string, string | number>) => () =>
  http.get(path, { ...(query ? { query } : {}), operationId: `record ${path}` });
const cliJson = (args: string[]) => async () => (await cli.run(args, { json: true, timeoutMs: 120_000 })).json;

// `liara` on PATH, else `npx -y @liara/cli`
const cliInfo = await cli.ensureCli();
console.log(`liara cli: ${cliInfo.available ? `v${cliInfo.version ?? '?'}${cliInfo.viaNpx ? ' (npx)' : ''}` : 'NOT AVAILABLE'}`);

// ---- app-independent ------------------------------------------------------
await record('projects.list', get('/v1/projects'));
await record('billing', get('/v1/billing'));
await record('cli.plan-list', cliJson(['plan:list']));
await record('cli.db-list', cliJson(['db', 'list']));
await record('cli.app-list', cliJson(['app:list']));

// ---- app-specific -----------------------------------------------------------
if (app !== 'none') {
  const enc = encodeURIComponent(app);
  const projects = (await http.get('/v1/projects')) as { projects?: Array<{ _id?: string; project_id?: string }> };
  const id = projects.projects?.find((p) => p.project_id === app)?._id;
  const now = Math.floor(Date.now() / 1000);

  await record('metrics.summary', get(`/v1/projects/${enc}/metrics/summary`));
  for (const kind of ['cpu', 'memory', 'network-receive', 'network-transmit']) {
    await record(`metrics.${kind}.since-absolute`, get(`/v1/projects/${enc}/metrics/${kind}`, { since: now - 3600 }));
    await record(`metrics.${kind}.since-relative`, get(`/v1/projects/${enc}/metrics/${kind}`, { since: 3600 }));
  }
  await record('logs.since-unix-s', get(`/v1/projects/${enc}/logs`, { since: now - 3600 }));
  await record('logs.since-unix-ms', get(`/v1/projects/${enc}/logs`, { since: (now - 3600) * 1000 }));
  await record('logs.since-iso', get(`/v1/projects/${enc}/logs`, { since: new Date((now - 3600) * 1000).toISOString() }));
  await record('events', get(`/v1/projects/${enc}/events`, { start: now - 7 * 86400, end: now }));
  if (id) await record('disks.list', get(`/v1/projects/${encodeURIComponent(id)}/disks`));
  await record('domains.list', get('/v1/domains', { project: app }));
  // values replaced by redactFixture (`value` is a sensitive key); only the shape is kept
  await record('cli.env-list', cliJson(['env:list', '-a', app]));
}

// ---- verify ---------------------------------------------------------------
const findings = findSecrets(OUT, { knownSecrets: secrets });
for (const s of summary) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name}  ${s.note}`);
if (findings.length) {
  for (const f of findings) console.error(`secret check: ${f.file}: ${f.rule} ${f.masked}`);
  console.error('Secret check FAILED — do not commit fixtures/liara/recorded/ until fixed.');
  process.exit(1);
}
console.log(`secret check OK (${OUT})`);
