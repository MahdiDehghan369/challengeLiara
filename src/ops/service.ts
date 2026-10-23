import type { App, AppEvent, DeploymentRecord, Domain, LiaraClient, MetricUnit } from '../liara/index.js';
import type { PlanCatalog, PlanEntry } from '../planner/plans.js';
import { isSiavashError } from '../shared/errors.js';
import { probe, type ProbeOptions, type ProbeResult } from '../sre/health.js';
import { percentOfPlan } from '../sre/metrics.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { listDisksWithUsage, type DiskWithUsage } from './backups.js';
import { listEnvMasked } from './env.js';

/**
 * App overview (T6.1): every source is fetched in parallel with `Promise.allSettled`, so one failing
 * source marks the overview `partial` instead of breaking it. Read-only (R0).
 */

export type Section<T> = { ok: true; value: T } | { ok: false; errorFa: string; code: string };

export interface MetricsBrief {
  applets: Array<{ applet: string; cpu: number | undefined; memory: number | undefined; cpuPct: number | undefined; memoryPct: number | undefined }>;
  /** TODO(OQ-3): metric units are unconfirmed; percentages only when `units` are given. */
  units: { cpu: MetricUnit; memory: MetricUnit };
}

export interface AppOverview {
  app: string;
  status: Section<Pick<App, 'name' | 'status' | 'scale' | 'planID' | 'platform' | 'isDeployed' | 'createdAt'>>;
  plan: Section<PlanEntry | undefined>;
  lastDeploy: Section<DeploymentRecord | undefined>;
  envCount: Section<number>;
  domains: Section<Array<Pick<Domain, 'name' | 'status' | 'certificatesStatus'>>>;
  disks: Section<DiskWithUsage[]>;
  metrics: Section<MetricsBrief>;
  events: Section<Array<Pick<AppEvent, 'ts' | 'kind' | 'message'>>>;
  probe: Section<Pick<ProbeResult, 'url' | 'availability' | 'p50' | 'p95' | 'statusHistogram' | 'errorHistogram'>>;
  partial: boolean;
  failed: string[];
}

export interface OverviewDeps {
  liara: Pick<LiaraClient, 'apps' | 'ledger' | 'env' | 'domains' | 'disks' | 'metrics' | 'events'>;
  catalog?: PlanCatalog;
  urlFor?: (app: string) => string | Promise<string>;
  probe?: Pick<ProbeOptions, 'count' | 'timeoutMs' | 'fetchImpl'>;
  units?: { cpu?: MetricUnit; memory?: MetricUnit };
  /** Events window (default 1 h). */
  eventsWindowSec?: number;
  now?: () => number;
}

function settle<T>(r: PromiseSettledResult<T>): Section<T> {
  if (r.status === 'fulfilled') return { ok: true, value: r.value };
  const e = r.reason;
  return { ok: false, errorFa: isSiavashError(e) ? e.messageFa : fa.overview.sourceFailed, code: isSiavashError(e) ? e.code : 'ERROR' };
}

export async function getAppOverview(name: string, deps: OverviewDeps): Promise<AppOverview> {
  const { liara } = deps;
  const now = deps.now ?? Date.now;
  const units = { cpu: deps.units?.cpu ?? 'unknown', memory: deps.units?.memory ?? 'unknown' } as const;
  const appP = liara.apps.getApp(name, { fresh: true });
  const planP = appP.then((a) => (deps.catalog && a.planID ? deps.catalog.planById(a.planID) : undefined));

  const [status, plan, lastDeploy, envCount, domains, disks, metrics, events, probed] = await Promise.allSettled([
    appP.then((a) => ({ name: a.name, status: a.status, scale: a.scale, planID: a.planID, platform: a.platform, isDeployed: a.isDeployed, createdAt: a.createdAt })),
    planP,
    Promise.resolve().then(() => liara.ledger.latest(name)),
    listEnvMasked(liara.env, name).then((l) => l.length),
    liara.domains.listDomains(name).then((ds) => ds.map((d) => ({ name: d.name, status: d.status, certificatesStatus: d.certificatesStatus }))),
    listDisksWithUsage(liara.disks, liara.metrics, name).then((r) => r.disks),
    Promise.all([liara.metrics.getSummary(name), planP.catch(() => undefined)]).then(([s, p]): MetricsBrief => {
      const applets = new Set([...s.cpu.map((v) => v.applet), ...s.memory.map((v) => v.applet)]);
      return {
        units,
        applets: [...applets].map((applet) => {
          const cpu = s.cpu.find((v) => v.applet === applet)?.value;
          const memory = s.memory.find((v) => v.applet === applet)?.value;
          return {
            applet,
            cpu,
            memory,
            cpuPct: percentOfPlan(cpu, 'cpu', units.cpu, p),
            memoryPct: percentOfPlan(memory, 'memory', units.memory, p),
          };
        }),
      };
    }),
    liara.events
      .getEvents(name, { start: Math.floor(now() / 1000) - (deps.eventsWindowSec ?? 3600) })
      .then((es) => es.slice(-20).map((e) => ({ ts: e.ts, kind: e.kind, message: e.message }))),
    deps.urlFor
      ? Promise.resolve(deps.urlFor(name)).then((url) =>
          probe(url, { paths: ['/'], count: 2, timeoutMs: 10_000, ...deps.probe }).then((r) => ({
            url: r.url,
            availability: r.availability,
            p50: r.p50,
            p95: r.p95,
            statusHistogram: r.statusHistogram,
            errorHistogram: r.errorHistogram,
          })),
        )
      : Promise.reject(new Error('no url')),
  ]);

  const sections = { status, plan, lastDeploy, envCount, domains, disks, metrics, events, probe: probed };
  const out = Object.fromEntries(Object.entries(sections).map(([k, r]) => [k, settle(r as PromiseSettledResult<unknown>)])) as Omit<AppOverview, 'app' | 'partial' | 'failed'>;
  // probe without a URL resolver is "not requested", not a failure
  if (!deps.urlFor) out.probe = { ok: false, errorFa: fa.overview.probeSkipped, code: 'SKIPPED' };
  const failed = Object.entries(out)
    .filter(([, s]) => !s.ok && s.code !== 'SKIPPED')
    .map(([k]) => k);
  return { app: name, ...out, partial: failed.length > 0, failed };
}
