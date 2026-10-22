import { nowUnix } from '../../shared/time.js';
import type { LiaraHttp } from '../http.js';
import {
  MetricsSeriesResponseSchema,
  MetricsSummaryResponseSchema,
  type MetricKind,
  type MetricSeriesResult,
  type MetricUnit,
  type MetricsSummary,
  type SummaryValue,
} from './schemas/metrics.js';

/**
 * How the `since` query is encoded. TODO(OQ-2): unconfirmed. 'absolute' = unix seconds of the window
 * start (Liara calls the log param a "timestamp"); 'relative' = the window length in seconds.
 */
export type MetricsSinceMode = 'absolute' | 'relative';

export interface MetricsApiOptions {
  sinceMode?: MetricsSinceMode;
  now?: () => number;
}

const UNITS: Record<MetricKind, MetricUnit> = {
  cpu: 'unknown',
  memory: 'unknown',
  'network-receive': 'unknown',
  'network-transmit': 'unknown',
};

function toNum(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
}

/** Summary `value` is an array; when it is `[ts, value]` (Prometheus style) take both, else the last element. */
function summaryValue(applet: string | undefined, value: Array<number | string>): SummaryValue {
  const v = toNum(value[value.length - 1]);
  const ts = value.length >= 2 ? toNum(value[0]) : NaN;
  return {
    applet: applet ?? '',
    value: Number.isFinite(v) ? v : undefined,
    ts: Number.isFinite(ts) ? ts : undefined,
  };
}

export class MetricsApi {
  private readonly sinceMode: MetricsSinceMode;
  private readonly now: () => number;

  constructor(
    private readonly http: LiaraHttp,
    opts: MetricsApiOptions = {},
  ) {
    this.sinceMode = opts.sinceMode ?? 'absolute';
    this.now = opts.now ?? nowUnix;
  }

  /** Converts "last N seconds" into the `since` query value. */
  toSince(windowSec: number): number {
    return this.sinceMode === 'absolute' ? this.now() - Math.round(windowSec) : Math.round(windowSec);
  }

  /** `GET /v1/projects/{name}/metrics/summary`. */
  async getSummary(name: string): Promise<MetricsSummary> {
    const r = await this.http.get(`/v1/projects/${encodeURIComponent(name)}/metrics/summary`, {
      schema: MetricsSummaryResponseSchema,
      operationId: 'metrics.summary',
    });
    return {
      cpu: r.cpuUsage.map((c) => summaryValue(c.applet, c.value)),
      memory: r.memoryUsage.map((m) => summaryValue(m.applet, m.value)),
      disks: r.disksUsage.map((d) => ({
        name: d.name,
        sizeRaw: d.size,
        usageRaw: d.usage,
        reportedAt: d.reportedAt,
      })),
    };
  }

  /** `GET /v1/projects/{name}/metrics/{kind}?since=` for the last `windowSec` seconds. */
  async getSeries(name: string, kind: MetricKind, windowSec: number): Promise<MetricSeriesResult> {
    const r = await this.http.get(`/v1/projects/${encodeURIComponent(name)}/metrics/${kind}`, {
      query: { since: this.toSince(windowSec) },
      schema: MetricsSeriesResponseSchema,
      operationId: `metrics.${kind}`,
    });
    let dropped = 0;
    const series = r.result.map((s) => {
      const points: Array<{ ts: number; value: number }> = [];
      for (const pair of s.values) {
        const ts = toNum(pair[0]);
        const value = toNum(pair[1]);
        if (Number.isFinite(ts) && Number.isFinite(value)) points.push({ ts, value });
        else dropped++;
      }
      return { applet: s.applet ?? '', points };
    });
    return { kind, unit: UNITS[kind], series, dropped, end: r.end };
  }
}
