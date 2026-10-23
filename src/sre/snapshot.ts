import type { App, AppEvent, DeploymentRecord, LiaraClient, MetricUnit } from '../liara/index.js';
import { listDisksWithUsage, type DiskWithUsage } from '../ops/backups.js';
import type { PlanCatalog, PlanEntry } from '../planner/plans.js';
import { readAudit } from '../safety/audit.js';
import { isSiavashError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { probe, type ProbeOptions, type ProbeResult } from './health.js';
import { collectLogs, type LogRecord } from './logs.js';
import { collectMetrics, type MetricAnalysis } from './metrics.js';

/**
 * State snapshot (T7.4): everything the detectors need, gathered in parallel with per-source timing.
 * A failing source sets `partial: true` and is listed in `failed`; the snapshot is plain JSON.
 */

export type Source<T> = { ok: true; value: T; ms: number } | { ok: false; errorFa: string; code: string; ms: number };

export interface EnvChange {
  ts: string;
  tool: string;
  /** Variable names only (values are never in the audit log). */
  keys: string[];
  result: string;
}

export interface Snapshot {
  app: string;
  takenAt: string;
  windowSec: number;
  sources: {
    app: Source<Pick<App, 'name' | 'status' | 'scale' | 'planID' | 'platform' | 'isDeployed'>>;
    plan: Source<PlanEntry | undefined>;
    lastDeploy: Source<DeploymentRecord | undefined>;
    events: Source<AppEvent[]>;
    metrics: Source<Record<'cpu' | 'memory', MetricAnalysis>>;
    logs: Source<LogRecord[]>;
    probe: Source<ProbeResult>;
    disks: Source<DiskWithUsage[]>;
    envChanges: Source<EnvChange[]>;
  };
  partial: boolean;
  failed: string[];
}

export interface SnapshotDeps {
  liara: Pick<LiaraClient, 'apps' | 'ledger' | 'events' | 'metrics' | 'logs' | 'disks'>;
  catalog?: PlanCatalog;
  urlFor?: (app: string) => string | Promise<string>;
  probe?: Pick<ProbeOptions, 'count' | 'timeoutMs' | 'fetchImpl'>;
  /** TODO(OQ-3): metric units, once known. */
  units?: { cpu?: MetricUnit; memory?: MetricUnit };
  /** `${DATA_DIR}` for the audit log (recent env changes). */
  dataDir?: string;
  maxLogRecords?: number;
  now?: () => number;
}

async function timed<T>(fn: () => Promise<T>, clock: () => number): Promise<Source<T>> {
  const start = clock();
  try {
    const value = await fn();
    return { ok: true, value, ms: clock() - start };
  } catch (e) {
    return {
      ok: false,
      errorFa: isSiavashError(e) ? e.messageFa : fa.overview.sourceFailed,
      code: isSiavashError(e) ? e.code : 'ERROR',
      ms: clock() - start,
    };
  }
}

function envKeysOf(params: Record<string, unknown>): string[] {
  const vars = params.vars;
  if (vars && typeof vars === 'object' && !Array.isArray(vars)) return Object.keys(vars);
  if (Array.isArray(params.keys)) return params.keys.filter((k): k is string => typeof k === 'string');
  return [];
}

export async function takeSnapshot(app: string, windowSec: number, deps: SnapshotDeps): Promise<Snapshot> {
  const { liara } = deps;
  const now = deps.now ?? Date.now;
  const clock = () => performance.now();
  const sinceMs = now() - windowSec * 1000;
  const appP = liara.apps.getApp(app, { fresh: true });
  const planP = appP.then((a) => (deps.catalog && a.planID ? deps.catalog.planById(a.planID) : undefined));
  // the plan only refines metric percentages; its failure is reported by the `plan` source
  const planOrUndefined = planP.catch(() => undefined);
  const units = { ...(deps.units?.cpu ? { cpu: deps.units.cpu } : {}), ...(deps.units?.memory ? { memory: deps.units.memory } : {}) };

  const [appS, plan, lastDeploy, events, metrics, logs, probed, disks, envChanges] = await Promise.all([
    timed(async () => {
      const a = await appP;
      return { name: a.name, status: a.status, scale: a.scale, planID: a.planID, platform: a.platform, isDeployed: a.isDeployed };
    }, clock),
    timed(() => planP, clock),
    timed(async () => liara.ledger.latest(app), clock),
    timed(() => liara.events.getEvents(app, { start: Math.floor(sinceMs / 1000) }), clock),
    timed(async () => {
      const p = await planOrUndefined;
      return collectMetrics(liara.metrics, app, windowSec, { ...(p ? { plan: p } : {}), units });
    }, clock),
    timed(async () => (await collectLogs(liara.logs, app, { windowSec })).slice(-(deps.maxLogRecords ?? 500)), clock),
    timed(async () => {
      if (!deps.urlFor) throw new Error('no url resolver');
      return probe(await deps.urlFor(app), { paths: ['/health', '/'], count: 2, timeoutMs: 10_000, ...deps.probe });
    }, clock),
    timed(async () => (await listDisksWithUsage(liara.disks, liara.metrics, app)).disks, clock),
    timed(async () => {
      if (!deps.dataDir) return [];
      return readAudit(deps.dataDir, { since: new Date(sinceMs), app })
        .filter((e) => e.tool === 'set_env' || e.tool === 'unset_env')
        .map((e) => ({ ts: e.ts, tool: e.tool, keys: envKeysOf(e.paramsRedacted), result: e.result }));
    }, clock),
  ]);

  const sources = { app: appS, plan, lastDeploy, events, metrics, logs, probe: probed, disks, envChanges };
  const failed = Object.entries(sources)
    .filter(([, s]) => !s.ok)
    .map(([k]) => k);
  return { app, takenAt: new Date(now()).toISOString(), windowSec, sources, partial: failed.length > 0, failed };
}
