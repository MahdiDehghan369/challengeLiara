/**
 * T0.8 spike — shared pieces: live or mock context, human confirmation before every change, step timers,
 * a polling observer that records what each signal says over time, redacted fixture recording, and the
 * exact cleanup commands to print if anything goes wrong.
 *
 * Only `siavash-spike-*` apps are ever changed. The token is read from the environment / .env / the
 * credentials file and is never printed or written.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AppsApi } from '../../src/liara/api/apps.js';
import { DeployApi } from '../../src/liara/api/deploy.js';
import { SettingsApi } from '../../src/liara/api/settings.js';
import { LiaraCli } from '../../src/liara/cli.js';
import { LiaraHttp } from '../../src/liara/http.js';
import { createCliMock, createMockFetch, MockAppServers, MockLiaraState } from '../../src/liara/mock/index.js';
import { isSiavashError } from '../../src/shared/errors.js';
import { findSecrets } from '../check-secrets.js';
import { redactFixture } from '../redact-fixture.js';

export const SPIKE_PREFIX = 'siavash-spike-';
export const SPIKE_NAME_RE = /^siavash-spike-[a-z0-9]+$/;
export const API_BASE = 'https://api.liara.ir';

// ---- context -------------------------------------------------------------------

export interface SpikeTimings {
  intervalMs: number;
  /** Max wait for a build / release to show a final signal. */
  buildTimeoutMs: number;
  /** Max wait for restart / scale / create / delete to settle. */
  stateTimeoutMs: number;
  /** Extra observation after an env update (did it restart the app?). */
  envObserveMs: number;
}

export interface SpikeContext {
  mode: 'live' | 'mock';
  token: string;
  teamId: string | undefined;
  knownSecrets: string[];
  http: LiaraHttp;
  apps: AppsApi;
  deploy: DeployApi;
  settings: SettingsApi;
  cli: LiaraCli;
  /** fetch used for raw calls (headers, teamID modes); the mock routes it to the fake Liara. */
  rawFetch: typeof fetch;
  /** The public URL of an app (live: https://<name>.liara.run). */
  urlFor(app: string): Promise<string>;
  confirm: Confirmer;
  timings: SpikeTimings;
  outDir: string;
  /** Mock only. */
  mock?: { state: MockLiaraState; servers: MockAppServers };
  log(line: string): void;
}

export interface Confirmer {
  /** y/N for a change; prints the exact action first. */
  yes(what: string, detail: string[]): Promise<boolean>;
  /** The user must type `name` (deletes). */
  typed(what: string, name: string): Promise<boolean>;
  /** Free text (e.g. what the panel shows); empty = skipped. */
  ask(question: string): Promise<string>;
}

export const LIVE_TIMINGS: SpikeTimings = { intervalMs: 3000, buildTimeoutMs: 15 * 60_000, stateTimeoutMs: 5 * 60_000, envObserveMs: 45_000 };
export const MOCK_TIMINGS: SpikeTimings = { intervalMs: 20, buildTimeoutMs: 3000, stateTimeoutMs: 3000, envObserveMs: 200 };

/** Ctrl+C at a prompt ends the run through `onAbort` (prints the cleanup commands). */
export function readlineConfirmer(onAbort: () => never): Confirmer {
  const question = async (q: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => {
      rl.close();
      onAbort();
    });
    try {
      return await rl.question(q);
    } finally {
      rl.close();
    }
  };
  return {
    yes: async (what, detail) => {
      console.log(`\n=== CHANGE: ${what}`);
      for (const d of detail) console.log(`    ${d}`);
      return /^y(es)?$/i.test((await question('    Run it? [y/N] ')).trim());
    },
    typed: async (what, name) => {
      console.log(`\n=== IRREVERSIBLE: ${what}`);
      return (await question(`    Type the app name (${name}) to confirm: `)).trim() === name;
    },
    ask: async (q) => (await question(`\n??? ${q}\n    > `)).trim(),
  };
}

/** Mock runs answer yes / type the name / skip free text. */
export const autoConfirmer: Confirmer = { yes: async () => true, typed: async () => true, ask: async () => '' };

export function liveContext(opts: { token: string; teamId: string | undefined; knownSecrets: string[]; confirm: Confirmer; outDir: string; teamIdMode?: 'query' | 'header' }): SpikeContext {
  const http = new LiaraHttp({ token: opts.token, teamId: opts.teamId, maxRetries: 1, ...(opts.teamIdMode ? { teamIdMode: opts.teamIdMode } : {}) });
  const apps = new AppsApi(http);
  return {
    mode: 'live',
    token: opts.token,
    teamId: opts.teamId,
    knownSecrets: opts.knownSecrets,
    http,
    apps,
    deploy: new DeployApi(http),
    settings: new SettingsApi(http, apps),
    cli: new LiaraCli({ token: opts.token, teamId: opts.teamId }),
    rawFetch: fetch,
    urlFor: async (app) => `https://${app}.liara.run`,
    confirm: opts.confirm,
    timings: LIVE_TIMINGS,
    outDir: opts.outDir,
    log: (l) => console.log(l),
  };
}

export function mockContext(opts: { outDir: string; log?: (l: string) => void; timings?: SpikeTimings }): SpikeContext {
  const state = new MockLiaraState({ asyncDelayMs: 5 });
  const token = 'mock-spike-token-0000';
  const fetchImpl = createMockFetch(state);
  const http = new LiaraHttp({ token, fetchImpl, sleep: async () => {}, maxRetries: 0 });
  const apps = new AppsApi(http);
  const servers = new MockAppServers(state);
  return {
    mode: 'mock',
    token,
    teamId: undefined,
    knownSecrets: [token],
    http,
    apps,
    deploy: new DeployApi(http),
    settings: new SettingsApi(http, apps),
    cli: new LiaraCli({ token, spawner: createCliMock(state) }),
    rawFetch: fetchImpl,
    urlFor: (app) => servers.urlFor(app),
    confirm: autoConfirmer,
    timings: opts.timings ?? MOCK_TIMINGS,
    outDir: opts.outDir,
    mock: { state, servers },
    log: opts.log ?? (() => {}),
  };
}

// ---- results --------------------------------------------------------------------

export interface Sample {
  /** ms since the observation started */
  t: number;
  status?: string | undefined;
  scale?: number | undefined;
  isDeployed?: boolean | undefined;
  listed?: boolean;
  probe?: string;
  events?: string[];
  logTail?: string;
}

export interface Observation {
  reached: boolean;
  elapsedMs: number;
  samples: Sample[];
  /** First t at which each named signal was seen. */
  firstSeen: Record<string, number>;
}

export interface SpikeResults {
  meta: { mode: string; app: string; startedAt: string; finishedAt?: string; cli?: string; teamConfigured: boolean };
  timings: Record<string, number | null>;
  observations: Record<string, Observation>;
  answers: Record<string, unknown>;
  steps: Array<{ step: string; ok: boolean; ms: number; note?: string }>;
  errors: Array<{ step: string; error: string }>;
}

export function newResults(mode: string, app: string, teamConfigured: boolean): SpikeResults {
  return { meta: { mode, app, startedAt: new Date().toISOString(), teamConfigured }, timings: {}, observations: {}, answers: {}, steps: [], errors: [] };
}

export function errorText(e: unknown): string {
  if (isSiavashError(e)) return `${e.name} ${e.code}${(e as { status?: number }).status ? ` HTTP ${(e as { status?: number }).status}` : ''}: ${e.message}`;
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** Runs a step, times it, records ok/failed — a failed step never stops the run. */
export async function step<T>(ctx: SpikeContext, r: SpikeResults, name: string, fn: () => Promise<T>): Promise<T | undefined> {
  const started = Date.now();
  ctx.log(`\n--- ${name}`);
  try {
    const v = await fn();
    const ms = Date.now() - started;
    r.steps.push({ step: name, ok: true, ms });
    ctx.log(`    ok (${(ms / 1000).toFixed(1)} s)`);
    return v;
  } catch (e) {
    const ms = Date.now() - started;
    const msg = redactString(errorText(e), ctx.knownSecrets);
    r.steps.push({ step: name, ok: false, ms, note: msg });
    r.errors.push({ step: name, error: msg });
    ctx.log(`    FAILED (${(ms / 1000).toFixed(1)} s): ${msg}`);
    return undefined;
  }
}

export function redactString(s: string, known: string[]): string {
  let out = s;
  for (const k of known) if (k && k.length >= 6) out = out.split(k).join('[REDACTED]');
  return out.replace(/(token=)[^&\s"']+/gi, '$1[REDACTED]').replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[REDACTED]');
}

// ---- observing ------------------------------------------------------------------

interface ProjectRow {
  project_id?: string;
  status?: string;
  scale?: number;
  isDeployed?: boolean;
  bundlePlanID?: string;
  planID?: string;
  type?: string;
}

export async function projectRow(ctx: SpikeContext, app: string): Promise<ProjectRow | undefined> {
  const list = (await ctx.http.get('/v1/projects', { operationId: 'spike list' })) as { projects?: ProjectRow[] };
  return list.projects?.find((p) => p.project_id === app);
}

export async function probeOnce(ctx: SpikeContext, url: string, timeoutMs = 8000): Promise<string> {
  const started = Date.now();
  try {
    const res = await ctx.rawFetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer().catch(() => undefined);
    return `${res.status} (${Date.now() - started} ms)`;
  } catch (e) {
    const c = (e as { cause?: { code?: string } }).cause?.code ?? (e as { name?: string }).name ?? 'error';
    return `ERR ${c} (${Date.now() - started} ms)`;
  }
}

/** Raw event rows since `startSec`, as compact strings (shape-agnostic; OQ-6). */
export async function eventTexts(ctx: SpikeContext, app: string, startSec: number): Promise<string[]> {
  const raw = (await ctx.http.get(`/v1/projects/${encodeURIComponent(app)}/events`, { query: { start: startSec, end: Math.floor(Date.now() / 1000) + 60 }, operationId: 'spike events' })) as { data?: unknown[] };
  return (raw.data ?? []).map((d) => JSON.stringify(d).slice(0, 300));
}

export async function logTail(ctx: SpikeContext, app: string): Promise<string | undefined> {
  const since = Math.floor(Date.now() / 1000) - 600;
  const raw = (await ctx.http.get(`/v1/projects/${encodeURIComponent(app)}/logs`, { query: { since }, operationId: 'spike logs' })) as unknown;
  const rows = Array.isArray(raw) ? raw : [];
  const last = rows[rows.length - 1] as { message?: string } | undefined;
  return last?.message ? String(last.message).slice(0, 200) : undefined;
}

/**
 * Polls list status, probe, events and the log tail until `until` says done (or timeout). Every sample is
 * kept, so BEHAVIOR.md can show the real sequence of states, not just the end.
 */
export async function observe(
  ctx: SpikeContext,
  app: string,
  label: string,
  until: (s: Sample, all: Sample[]) => boolean,
  opts: { timeoutMs: number; probe?: boolean; events?: boolean; logs?: boolean; signals?: Record<string, (s: Sample) => boolean> },
): Promise<Observation> {
  const started = Date.now();
  const startSec = Math.floor(started / 1000) - 2;
  const url = await ctx.urlFor(app);
  const samples: Sample[] = [];
  const firstSeen: Record<string, number> = {};
  const seenEvents = new Set<string>();
  for (;;) {
    const s: Sample = { t: Date.now() - started };
    try {
      const row = await projectRow(ctx, app);
      s.listed = !!row;
      s.status = row?.status;
      s.scale = row?.scale;
      s.isDeployed = row?.isDeployed;
    } catch (e) {
      s.status = `ERR ${errorText(e).slice(0, 60)}`;
    }
    if (opts.probe !== false) s.probe = await probeOnce(ctx, url);
    if (opts.events !== false) {
      const evs = await eventTexts(ctx, app, startSec).catch((e: unknown) => [`ERR ${errorText(e).slice(0, 80)}`]);
      const fresh = evs.filter((e) => !seenEvents.has(e));
      for (const e of fresh) seenEvents.add(e);
      if (fresh.length) s.events = fresh.map((e) => redactString(e, ctx.knownSecrets));
    }
    if (opts.logs !== false) s.logTail = await logTail(ctx, app).then((l) => (l ? redactString(l, ctx.knownSecrets) : undefined)).catch(() => undefined);
    samples.push(s);
    for (const [name, pred] of Object.entries(opts.signals ?? {})) if (firstSeen[name] === undefined && pred(s)) firstSeen[name] = s.t;
    ctx.log(`    [${label} +${(s.t / 1000).toFixed(1)}s] listed=${s.listed} status=${s.status} scale=${s.scale} isDeployed=${s.isDeployed}${s.probe ? ` probe=${s.probe}` : ''}${s.events ? ` events+${s.events.length}` : ''}`);
    if (until(s, samples)) return { reached: true, elapsedMs: s.t, samples, firstSeen };
    if (Date.now() - started > opts.timeoutMs) return { reached: false, elapsedMs: Date.now() - started, samples, firstSeen };
    await new Promise((res) => setTimeout(res, ctx.timings.intervalMs));
    if (ctx.mock) await ctx.mock.state.settle();
  }
}

export const probeCode = (s: Sample): number | undefined => (s.probe && /^\d{3}/.test(s.probe) ? Number(s.probe.slice(0, 3)) : undefined);

// ---- fixtures ----------------------------------------------------------------------

/** Writes a redacted JSON fixture under `<outDir>/<rel>`. */
export function writeFixture(ctx: SpikeContext, rel: string, data: unknown): void {
  const file = join(ctx.outDir, rel);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(redactFixture(data, { knownSecrets: ctx.knownSecrets }), null, 2)}\n`, 'utf8');
}

async function recordOne(ctx: SpikeContext, dir: string, name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    writeFixture(ctx, join(dir, `${name}.json`), await fn());
    return true;
  } catch (e) {
    const err = isSiavashError(e) ? { error: e.name, code: e.code, status: (e as { status?: number }).status ?? null } : { error: errorText(e) };
    writeFixture(ctx, join(dir, `${name}.error.json`), err);
    return false;
  }
}

/**
 * App-specific fixtures (the set T0.5 could not record) at one point of the run, plus the spec-only
 * read endpoints (OQ-8/9/10). Read-only.
 */
export async function recordAppFixtures(ctx: SpikeContext, app: string, dir: string): Promise<{ ok: number; failed: number }> {
  const enc = encodeURIComponent(app);
  const now = Math.floor(Date.now() / 1000);
  const get = (path: string, query?: Record<string, string | number>) => () => ctx.http.get(path, { ...(query ? { query } : {}), operationId: `spike record ${path}` });
  const jobs: Array<[string, () => Promise<unknown>]> = [
    ['projects.list', get('/v1/projects')],
    ['metrics.summary', get(`/v1/projects/${enc}/metrics/summary`)],
    ...['cpu', 'memory', 'network-receive', 'network-transmit'].flatMap((k): Array<[string, () => Promise<unknown>]> => [
      [`metrics.${k}.since-absolute`, get(`/v1/projects/${enc}/metrics/${k}`, { since: now - 3600 })],
      [`metrics.${k}.since-relative`, get(`/v1/projects/${enc}/metrics/${k}`, { since: 3600 })],
    ]),
    ['logs.since-unix-s', get(`/v1/projects/${enc}/logs`, { since: now - 3600 })],
    ['logs.since-unix-ms', get(`/v1/projects/${enc}/logs`, { since: (now - 3600) * 1000 })],
    ['logs.since-iso', get(`/v1/projects/${enc}/logs`, { since: new Date((now - 3600) * 1000).toISOString() })],
    ['events', get(`/v1/projects/${enc}/events`, { start: now - 86400, end: now + 60 })],
    ['domains.list', get('/v1/domains', { project: app })],
    // spec-only reads (OQ-8 / OQ-9 / OQ-10): an error file means "not available"
    ['spec.project-details', get(`/v1/projects/${enc}`)],
    ['spec.releases', get(`/v1/projects/${enc}/releases`)],
    ['spec.applets', get(`/v1/projects/${enc}/applets`)],
    ['cli.env-list', async () => (await ctx.cli.run(['env:list', '-a', app, '--output', 'json'], { json: true, timeoutMs: 120_000 })).json],
  ];
  let ok = 0;
  let failed = 0;
  for (const [name, fn] of jobs) (await recordOne(ctx, dir, name, fn)) ? ok++ : failed++;
  return { ok, failed };
}

export function secretCheck(ctx: SpikeContext): string[] {
  return findSecrets(ctx.outDir, { knownSecrets: ctx.knownSecrets }).map((f) => `${f.file}: ${f.rule} ${f.masked}`);
}

// ---- projects to deploy ----------------------------------------------------------

/** Copies a demo app to a temp dir without node_modules (and optionally patches package.json). */
export function stageProject(repoRoot: string, demo: string, patch?: (pkg: Record<string, unknown>) => void): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'siavash-spike-src-')), demo);
  cpSync(join(repoRoot, 'demo-apps', demo), dir, { recursive: true, filter: (s) => !s.split(sep).includes('node_modules') && !s.endsWith(`${sep}dist`) });
  if (patch) {
    const p = join(dir, 'package.json');
    const pkg = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
    patch(pkg);
    writeFileSync(p, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return dir;
}

// ---- cleanup hints -------------------------------------------------------------------

export function cleanupCommands(app: string): string[] {
  return [
    `liara delete --app ${app}`,
    `curl -X DELETE ${API_BASE}/v1/projects/${app} -H "Authorization: Bearer $LIARA_API_TOKEN"`,
    'pnpm exec tsx scripts/spike/cleanup.ts   # finds and deletes every leftover siavash-spike-* app',
  ];
}

export function printCleanup(app: string | undefined): void {
  if (!app) return;
  console.error(`\n!!! The spike app ${app} may still exist (it costs money while it runs). Delete it with one of:`);
  for (const c of cleanupCommands(app)) console.error(`    ${c}`);
}
