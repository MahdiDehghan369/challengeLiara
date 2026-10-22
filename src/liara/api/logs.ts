import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LiaraHttp } from '../http.js';

/** `GET /v1/projects/{name}/logs` → `[{type, datetime, message}]` (#/components/schemas/Logs). */
export const LogsResponseSchema = z.array(
  z
    .object({
      type: z.string().optional(),
      datetime: z.union([z.string(), z.number()]).optional(),
      message: z.string().default(''),
    })
    .passthrough(),
);

/** One log line, identical for the API and CLI paths. `ts` = unix milliseconds (NaN-free; 0 if unknown). */
export interface LogLine {
  ts: number;
  stream: string;
  text: string;
  source: 'api' | 'cli';
}

/**
 * Encoding of the `since` query. TODO(OQ-1): unconfirmed (spec: string, "Show logs since timestamp").
 * T0.5 records all three variants; until then unix seconds is the default.
 */
export type LogsSinceFormat = 'unix-s' | 'unix-ms' | 'iso';

/** Minimal CLI surface needed here; implemented by the Liara CLI wrapper (T1.14). */
export interface LogsCli {
  /** Runs `liara <args>` and returns stdout once it exits. */
  run(args: string[]): Promise<{ stdout: string }>;
  /** Runs `liara <args>` and yields stdout lines as they arrive (for `-f`). */
  streamLines(args: string[], signal?: AbortSignal): AsyncIterable<string>;
}

export interface LogsApiOptions {
  sinceFormat?: LogsSinceFormat;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  cli?: LogsCli;
}

export interface GetLogsOptions {
  /** Last N seconds. */
  windowSec?: number;
  /** Absolute start, unix milliseconds. Wins over windowSec. */
  sinceTs?: number;
}

export interface TailOptions {
  intervalMs?: number;
  /** Start point, unix ms. Defaults to now − 60s. */
  sinceTs?: number;
  signal?: AbortSignal;
}

const DEFAULT_WINDOW_SEC = 3600;
const DEDUPE_MAX = 5_000;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;
const LEADING_TS_RE = /^\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s+(.*)$/;

function parseDatetime(v: string | number | undefined): number {
  if (v === undefined) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const n = Number(v);
  if (v.trim() !== '' && Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Parses one line of `liara logs -t` text output. TODO(OQ-14): exact format unconfirmed; assumes an
 * optional leading ISO-8601 timestamp (docker style) and keeps the raw text otherwise.
 */
export function parseCliLogLine(raw: string): LogLine | undefined {
  const line = raw.replace(ANSI_RE, '').replace(/\r$/, '');
  if (line.trim() === '') return undefined;
  const m = LEADING_TS_RE.exec(line);
  if (m) {
    const ts = Date.parse((m[1] as string).replace(' ', 'T'));
    if (!Number.isNaN(ts)) return { ts, stream: 'stdout', text: m[2] as string, source: 'cli' };
  }
  return { ts: 0, stream: 'stdout', text: line, source: 'cli' };
}

export function logLineHash(l: LogLine): string {
  return createHash('sha1').update(`${l.ts}\u0000${l.stream}\u0000${l.text}`).digest('hex');
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export class LogsApi {
  private readonly sinceFormat: LogsSinceFormat;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly cli: LogsCli | undefined;

  constructor(
    private readonly http: LiaraHttp,
    opts: LogsApiOptions = {},
  ) {
    this.sinceFormat = opts.sinceFormat ?? 'unix-s';
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.cli = opts.cli;
  }

  /** Encodes a unix-ms instant as the `since` query value. */
  formatSince(tsMs: number): string {
    if (this.sinceFormat === 'unix-ms') return String(Math.floor(tsMs));
    if (this.sinceFormat === 'iso') return new Date(tsMs).toISOString();
    return String(Math.floor(tsMs / 1000));
  }

  /** `GET /v1/projects/{name}/logs?since=` — no pagination on Liara's side. */
  async getLogs(name: string, opts: GetLogsOptions = {}): Promise<LogLine[]> {
    const sinceTs = opts.sinceTs ?? this.now() - (opts.windowSec ?? DEFAULT_WINDOW_SEC) * 1000;
    const rows = await this.http.get(`/v1/projects/${encodeURIComponent(name)}/logs`, {
      query: { since: this.formatSince(sinceTs) },
      schema: LogsResponseSchema,
      operationId: 'logs.get',
    });
    return rows.map((r) => ({
      ts: parseDatetime(r.datetime),
      stream: r.type ?? 'stdout',
      text: r.message,
      source: 'api' as const,
    }));
  }

  /** Incremental polling tail: since = last seen ts, duplicates dropped by hash. Ends when `signal` aborts. */
  async *tailLogs(name: string, opts: TailOptions = {}): AsyncIterable<LogLine> {
    const intervalMs = opts.intervalMs ?? 5_000;
    let since = opts.sinceTs ?? this.now() - 60_000;
    const seen = new Set<string>();
    while (!opts.signal?.aborted) {
      const lines = await this.getLogs(name, { sinceTs: since });
      for (const l of lines) {
        const h = logLineHash(l);
        if (seen.has(h)) continue;
        seen.add(h);
        if (seen.size > DEDUPE_MAX) seen.delete(seen.values().next().value as string);
        if (l.ts > since) since = l.ts;
        yield l;
      }
      if (opts.signal?.aborted) return;
      await this.sleep(intervalMs, opts.signal);
    }
  }

  /** Real-time logs through `liara logs -f -t` (alternative to polling). */
  async *followLogs(name: string, opts: { since?: string; signal?: AbortSignal } = {}): AsyncIterable<LogLine> {
    const args = ['logs', '-a', name, '-f', '-t', ...(opts.since ? ['-s', opts.since] : [])];
    for await (const raw of this.requireCli().streamLines(args, opts.signal)) {
      const l = parseCliLogLine(raw);
      if (l) yield l;
    }
  }

  /** Logs of one deployment version through `liara logs -r <version>` (no REST equivalent). */
  async getLogsByRelease(name: string, version: string): Promise<LogLine[]> {
    const { stdout } = await this.requireCli().run(['logs', '-a', name, '-t', '-r', version]);
    return stdout
      .split('\n')
      .map(parseCliLogLine)
      .filter((l): l is LogLine => l !== undefined);
  }

  private requireCli(): LogsCli {
    if (!this.cli) throw new Error('LogsApi: CLI runner not configured (needed for follow/release logs)');
    return this.cli;
  }
}
