import { z } from 'zod';

const NumOrStr = z.union([z.number(), z.string()]);

/** `GET /v1/projects/{name}/metrics/summary` (specs/paas.yaml). `value` is an array of number|string. */
export const MetricsSummaryResponseSchema = z.object({
  cpuUsage: z.array(z.object({ value: z.array(NumOrStr), applet: z.string().optional() }).passthrough()).default([]),
  memoryUsage: z
    .array(z.object({ value: z.array(NumOrStr), applet: z.string().optional() }).passthrough())
    .default([]),
  disksUsage: z
    .array(
      z
        .object({
          size: NumOrStr.optional(),
          usage: NumOrStr.optional(),
          reportedAt: z.string().optional(),
          name: z.string().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

/** `GET /v1/projects/{name}/metrics/{cpu|memory|network-receive|network-transmit}` (#/components/schemas/Reports). */
export const MetricsSeriesResponseSchema = z.object({
  end: z.coerce.number().optional(),
  result: z
    .array(
      z
        .object({
          values: z.array(z.array(NumOrStr)),
          applet: z.string().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export const METRIC_KINDS = ['cpu', 'memory', 'network-receive', 'network-transmit'] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

// TODO(OQ-3): CPU/RAM/network units are unconfirmed; everything is 'unknown' until BEHAVIOR §6 says otherwise.
export type MetricUnit = 'unknown' | 'percent' | 'cores' | 'bytes' | 'bytes/s';

export interface MetricPoint {
  ts: number;
  value: number;
}

export interface MetricSeries {
  applet: string;
  points: MetricPoint[];
}

export interface MetricSeriesResult {
  kind: MetricKind;
  unit: MetricUnit;
  series: MetricSeries[];
  /** Points dropped because ts or value was not a finite number. */
  dropped: number;
  end: number | undefined;
}

export interface SummaryValue {
  applet: string;
  value: number | undefined;
  ts: number | undefined;
}

export interface DiskUsage {
  name: string | undefined;
  sizeRaw: string | number | undefined;
  usageRaw: string | number | undefined;
  reportedAt: string | undefined;
}

export interface MetricsSummary {
  cpu: SummaryValue[];
  memory: SummaryValue[];
  disks: DiskUsage[];
}
