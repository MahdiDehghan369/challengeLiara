import { percentile, round } from '../shared/stats.js';

export type ProbeErrorKind = 'timeout' | 'dns' | 'tls' | 'connection' | 'other';

export interface ProbeSample {
  path: string;
  status?: number;
  ttfbMs?: number;
  totalMs: number;
  error?: ProbeErrorKind;
  errorCode?: string;
}

export interface ProbeResult {
  url: string;
  total: number;
  /** % of samples that answered with status < 500. */
  availability: number;
  p50: number | undefined;
  p95: number | undefined;
  /** Share (0..1) of samples that errored or returned 5xx. */
  errorRate: number;
  statusHistogram: Record<string, number>;
  errorHistogram: Record<ProbeErrorKind, number>;
  /** https only: false on any TLS error, true if at least one TLS handshake succeeded. */
  tlsValid: boolean | undefined;
  samples: ProbeSample[];
}

export interface ProbeOptions {
  paths?: string[];
  count?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME', 'EAI_NODATA']);
const CONN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_SOCKET']);
const TLS_RE = /^(CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|HOSTNAME_MISMATCH)/;

/** Classifies a fetch/undici failure (the real code is usually on `err.cause.code`). */
export function classifyProbeError(err: unknown): { kind: ProbeErrorKind; code?: string } {
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.cause?.name === 'ConnectTimeoutError') {
    return { kind: 'timeout', code: e.cause?.code ?? e.name };
  }
  const code = e?.cause?.code ?? e?.code;
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return { kind: 'timeout', code };
  if (code && DNS_CODES.has(code)) return { kind: 'dns', code };
  if (code && TLS_RE.test(code)) return { kind: 'tls', code };
  if (code && CONN_CODES.has(code)) return { kind: 'connection', code };
  if (/certificate|ssl|tls/i.test(e?.cause?.message ?? '')) return { kind: 'tls', ...(code ? { code } : {}) };
  return { kind: 'other', ...(code ? { code } : {}) };
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`);
}

/** Sends `count` sequential requests per path and summarizes availability, latency and error kinds. */
export async function probe(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const paths = opts.paths?.length ? opts.paths : ['/'];
  const count = opts.count ?? 3;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const samples: ProbeSample[] = [];

  for (const path of paths) {
    for (let i = 0; i < count; i++) {
      const started = performance.now();
      try {
        const res = await doFetch(joinUrl(url, path), {
          method: 'GET',
          redirect: 'manual',
          headers: { 'user-agent': 'siavash-agent/probe' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const ttfbMs = performance.now() - started;
        await res.arrayBuffer().catch(() => undefined);
        samples.push({ path, status: res.status, ttfbMs: round(ttfbMs), totalMs: round(performance.now() - started) });
      } catch (err) {
        const c = classifyProbeError(err);
        samples.push({
          path,
          totalMs: round(performance.now() - started),
          error: c.kind,
          ...(c.code ? { errorCode: c.code } : {}),
        });
      }
    }
  }

  const ok = samples.filter((s) => s.status !== undefined && s.status < 500);
  const bad = samples.filter((s) => s.error !== undefined || (s.status ?? 0) >= 500);
  const statusHistogram: Record<string, number> = {};
  for (const s of samples) if (s.status !== undefined) statusHistogram[s.status] = (statusHistogram[s.status] ?? 0) + 1;
  const errorHistogram: Record<ProbeErrorKind, number> = { timeout: 0, dns: 0, tls: 0, connection: 0, other: 0 };
  for (const s of samples) if (s.error) errorHistogram[s.error] += 1;
  const latencies = samples.filter((s) => s.status !== undefined).map((s) => s.totalMs);
  const https = url.startsWith('https://');

  return {
    url,
    total: samples.length,
    availability: samples.length ? round((ok.length / samples.length) * 100) : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    errorRate: samples.length ? round(bad.length / samples.length, 3) : 0,
    statusHistogram,
    errorHistogram,
    tlsValid: !https ? undefined : errorHistogram.tls > 0 ? false : samples.some((s) => s.status !== undefined) ? true : undefined,
    samples,
  };
}
