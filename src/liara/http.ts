import type { Logger } from 'pino';
import type { ZodType } from 'zod';
import { LiaraApiError, RateLimitError, ValidationError } from '../shared/errors.js';
import { logger as rootLogger } from '../shared/logger.js';
import { fa } from '../ui/cli/i18n/fa.js';

export const LIARA_API_BASE = 'https://api.liara.ir';
export const DEFAULT_TIMEOUT_MS = 20_000;
export const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

/** Body-less 200/204 replies (async "accepted" operations) are normalized to this. */
export interface Accepted {
  accepted: true;
}

export type QueryValue = string | number | boolean | undefined;

export interface RequestOptions<T> {
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** multipart/form-data body (source upload); uses the upload timeout. */
  multipart?: FormData;
  schema?: ZodType<T>;
  timeoutMs?: number;
  /** Logical operation name for errors/logs, e.g. "apps.list". */
  operationId?: string;
}

// TODO(OQ-13): how teamID is passed in REST (query param vs header) is unconfirmed (BEHAVIOR §10).
// The map calls it a "parameter", so query is the default; header mode exists for the spike to flip.
export type TeamIdMode = 'query' | 'header';

export interface LiaraHttpOptions {
  token: string;
  baseUrl?: string;
  teamId?: string | undefined;
  teamIdMode?: TeamIdMode;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  defaultTimeoutMs?: number;
  uploadTimeoutMs?: number;
  maxRetries?: number;
  logger?: Logger;
}

export interface HttpStats {
  requests: number;
  retries: number;
  rateLimited: number;
  errors: number;
}

type Method = 'GET' | 'POST' | 'DELETE';

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Parses Retry-After (seconds or HTTP date) into ms. */
export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

function statusMessageFa(status: number): string {
  if (status === 400) return fa.liaraHttp.badRequest;
  if (status === 401) return fa.liaraHttp.unauthorized;
  if (status === 403) return fa.liaraHttp.forbidden;
  if (status === 404) return fa.liaraHttp.notFound;
  if (status === 409) return fa.liaraHttp.conflict;
  if (status === 429) return fa.liaraHttp.rateLimited;
  if (status >= 500) return fa.liaraHttp.server;
  return fa.liaraHttp.unexpected;
}

function statusCode(status: number): string {
  const codes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    409: 'CONFLICT',
  };
  return codes[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'LIARA_API_ERROR');
}

/** Extracts Liara's own error message from a JSON/text body, if any (never includes request headers). */
function remoteMessage(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const m = j.message ?? j.error ?? j.msg;
    return typeof m === 'string' ? m.slice(0, 300) : undefined;
  } catch {
    return text.slice(0, 300);
  }
}

export class LiaraHttp {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly teamId: string | undefined;
  private readonly teamIdMode: TeamIdMode;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly defaultTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly log: Logger;
  private readonly stats: HttpStats = { requests: 0, retries: 0, rateLimited: 0, errors: 0 };

  constructor(opts: LiaraHttpOptions) {
    this.token = opts.token;
    this.baseUrl = (opts.baseUrl ?? LIARA_API_BASE).replace(/\/+$/, '');
    this.teamId = opts.teamId || undefined;
    this.teamIdMode = opts.teamIdMode ?? 'query';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.uploadTimeoutMs = opts.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? MAX_RETRIES;
    this.log = (opts.logger ?? rootLogger).child({ mod: 'liara-http' });
  }

  get<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
    return this.request('GET', path, opts);
  }

  post<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
    return this.request('POST', path, opts);
  }

  delete<T = unknown>(path: string, opts: RequestOptions<T> = {}): Promise<T> {
    return this.request('DELETE', path, opts);
  }

  getStats(): Readonly<HttpStats> {
    return { ...this.stats };
  }

  private buildUrl(path: string, query: Record<string, QueryValue> = {}): string {
    const url = new URL(this.baseUrl + (path.startsWith('/') ? path : `/${path}`));
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    if (this.teamId && this.teamIdMode === 'query') url.searchParams.set('teamID', this.teamId);
    return url.toString();
  }

  private buildHeaders(opts: RequestOptions<unknown>): Record<string, string> {
    const h: Record<string, string> = { authorization: `Bearer ${this.token}`, accept: 'application/json' };
    if (opts.body !== undefined && !opts.multipart) h['content-type'] = 'application/json';
    if (this.teamId && this.teamIdMode === 'header') h.teamID = this.teamId;
    return h;
  }

  private async request<T>(method: Method, path: string, opts: RequestOptions<T>): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const operationId = opts.operationId ?? `${method} ${path}`;
    // Only reads are retried; state-changing calls must never be repeated automatically.
    const maxAttempts = method === 'GET' ? this.maxRetries + 1 : 1;
    const timeoutMs = opts.timeoutMs ?? (opts.multipart ? this.uploadTimeoutMs : this.defaultTimeoutMs);

    for (let attempt = 1; ; attempt++) {
      this.stats.requests++;
      const started = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: this.buildHeaders(opts as RequestOptions<unknown>),
          body: opts.multipart ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (cause) {
        const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
        if (attempt < maxAttempts) {
          await this.backoff(attempt, undefined);
          continue;
        }
        this.stats.errors++;
        throw new LiaraApiError(`${operationId}: ${timedOut ? 'timeout' : 'network error'}`, {
          code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
          operationId,
          retryable: true,
          messageFa: timedOut ? fa.liaraHttp.timeout : fa.liaraHttp.network,
          details: { method, path, timeoutMs },
          cause,
        });
      }

      this.log.debug({ method, path, status: res.status, ms: Date.now() - started, attempt }, 'liara request');

      if (res.status === 429) this.stats.rateLimited++;
      if (!res.ok) {
        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
        if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
          await res.body?.cancel();
          await this.backoff(attempt, retryAfterMs);
          continue;
        }
        this.stats.errors++;
        const text = await res.text().catch(() => '');
        const remote = remoteMessage(text);
        const details = { method, path, status: res.status, ...(remote ? { remoteMessage: remote } : {}) };
        if (res.status === 429) {
          throw new RateLimitError(`${operationId}: HTTP 429`, {
            messageFa: fa.liaraHttp.rateLimited,
            details,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
          });
        }
        throw new LiaraApiError(`${operationId}: HTTP ${res.status}${remote ? ` — ${remote}` : ''}`, {
          status: res.status,
          code: statusCode(res.status),
          operationId,
          messageFa: statusMessageFa(res.status),
          details,
        });
      }

      return this.parseBody(res, opts.schema, operationId);
    }
  }

  private async backoff(attempt: number, retryAfterMs: number | undefined): Promise<void> {
    this.stats.retries++;
    const exp = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * BACKOFF_BASE_MS);
    await this.sleep(Math.min(BACKOFF_MAX_MS, retryAfterMs ?? exp + jitter));
  }

  private async parseBody<T>(res: Response, schema: ZodType<T> | undefined, operationId: string): Promise<T> {
    const text = await res.text();
    let data: unknown;
    if (text.trim() === '') {
      data = { accepted: true } satisfies Accepted;
    } else {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!schema) return data as T;
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new ValidationError(`${operationId}: response failed schema validation`, {
        messageFa: fa.liaraHttp.invalidResponse,
        details: {
          operationId,
          issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    return parsed.data;
  }
}
