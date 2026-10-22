import { z } from 'zod';
import type { LiaraHttp } from '../http.js';

// Per the map: `{data:[{metaData:{}, values:[[string]]}]}`. Items are taken as unknown and stringified
// so an unexpected element type never fails the whole response.
export const EventsResponseSchema = z.object({
  data: z
    .array(
      z
        .object({
          metaData: z.record(z.string(), z.unknown()).nullish(),
          values: z.array(z.array(z.unknown())).nullish(),
        })
        .passthrough(),
    )
    .default([]),
});

export const APP_EVENT_KINDS = ['deploy', 'restart', 'scale', 'crash', 'oom', 'config', 'unknown'] as const;
export type AppEventKind = (typeof APP_EVENT_KINDS)[number];

export interface AppEvent {
  /** Unix milliseconds, if a timestamp could be found in the row. */
  ts: number | undefined;
  kind: AppEventKind;
  message: string;
  /** The group's `metaData` plus fields of a JSON message. */
  meta: Record<string, unknown>;
  /** The original row as strings. */
  raw: string[];
}

export interface EventsQuery {
  /** Unix seconds. */
  start?: number;
  /** Unix seconds. */
  end?: number;
  search?: string;
}

// Order matters: the first match wins.
const KIND_RULES: Array<[AppEventKind, RegExp]> = [
  ['oom', /OOMKilled|out of memory|\boom\b|memory limit/i],
  ['crash', /crash|back-?off|exited|exit code|\bkilled\b|unhealthy|liveness|readiness|failed to start/i],
  ['deploy', /deploy|release|\bbuild\b|rollback/i],
  ['restart', /restart|\bstart(ed)?\b|\bstop(ped)?\b|shutdown|power/i],
  ['scale', /scale|scaling|replica/i],
  ['config', /\benvs?\b|environment|config|setting|domain|disk|plan|resize|fixed.?ip|subdomain|zero.?downtime|read.?only/i],
];

export function classifyEvent(text: string): AppEventKind {
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return 'unknown';
}

/** Normalizes a numeric timestamp of any precision (s / ms / µs / ns) to milliseconds. */
function toMs(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n >= 1e17) return Math.round(n / 1e6);
  if (n >= 1e14) return Math.round(n / 1e3);
  if (n >= 1e11) return Math.round(n);
  if (n >= 1e8) return Math.round(n * 1000);
  return undefined;
}

function parseTs(s: string): number | undefined {
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return toMs(Number(t));
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)) {
    const ms = Date.parse(t);
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function textOf(meta: Record<string, unknown>): string {
  return ['type', 'event', 'reason', 'action', 'kind', 'status']
    .map((k) => meta[k])
    .filter((v): v is string => typeof v === 'string')
    .join(' ');
}

/**
 * Parses one `values` row. TODO(OQ-6): the row layout is unconfirmed (BEHAVIOR §7). Until T0.8 records
 * it, the first element that looks like a timestamp is the time and the remaining strings are the
 * message (a JSON-object message is unpacked into `meta`). Anything else → kind `unknown` + raw text.
 */
export function parseEventRow(row: unknown[], groupMeta: Record<string, unknown> = {}): AppEvent {
  const raw = row.map(str);
  let ts: number | undefined;
  let tsIdx = -1;
  raw.some((s, i) => {
    const t = parseTs(s);
    if (t !== undefined) {
      ts = t;
      tsIdx = i;
    }
    return t !== undefined;
  });
  const rest = raw.filter((s, i) => i !== tsIdx && s.trim() !== '');
  let message = rest.join(' ').trim();
  const meta: Record<string, unknown> = { ...groupMeta };
  if (rest.length === 1 && /^\s*\{/.test(message)) {
    try {
      const obj: unknown = JSON.parse(message);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        Object.assign(meta, obj);
        const m = (obj as Record<string, unknown>).message ?? (obj as Record<string, unknown>).msg;
        if (typeof m === 'string') message = m;
      }
    } catch {
      // not JSON — keep the text
    }
  }
  if (message === '') message = raw.join(' ');
  const kind = classifyEvent(`${textOf(meta)} ${message}`);
  return { ts, kind, message, meta, raw };
}

export class EventsApi {
  constructor(private readonly http: LiaraHttp) {}

  /** `GET /v1/projects/{name}/events?search&start&end` (start/end in unix seconds), oldest first. */
  async getEvents(name: string, q: EventsQuery = {}): Promise<AppEvent[]> {
    const r = await this.http.get(`/v1/projects/${encodeURIComponent(name)}/events`, {
      query: {
        start: q.start !== undefined ? Math.floor(q.start) : undefined,
        end: q.end !== undefined ? Math.floor(q.end) : undefined,
        search: q.search || undefined,
      },
      schema: EventsResponseSchema,
      operationId: 'events',
    });
    const events = r.data.flatMap((g) => (g.values ?? []).map((row) => parseEventRow(row, g.metaData ?? {})));
    // stable: rows without a timestamp keep their order at the end
    return events
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.ts ?? Infinity) - (b.e.ts ?? Infinity) || a.i - b.i)
      .map(({ e }) => e);
  }
}
