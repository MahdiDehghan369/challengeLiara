import { waitAppRunning, waitAppScale, waitForState, type App, type AppEvent, type AppsApi, type DeploymentRecord, type Domain, type LiaraClient, type MetricUnit, type WaitOptions } from '../liara/index.js';
import { guard, type GuardResult } from '../safety/approval.js';
import { escalate, RISK_TOOLS, Risk, type ActionPlan } from '../safety/risk.js';
import { guardOptions, newPlanId, type OpsContext } from './context.js';
import { appMonthlyPrice, requiredBalance } from '../planner/cost.js';
import type { Bundle, PlanCatalog, PlanEntry } from '../planner/plans.js';
import { isSiavashError, LiaraApiError } from '../shared/errors.js';
import { toman } from '../ui/cli/format.js';
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

// ---- restart / start / stop (T6.2) ------------------------------------------

export type PowerAction = 'restart' | 'start' | 'stop';

export interface PowerOptions {
  reasonFa?: string;
  /** Zero-downtime setting of the app, if known. */
  zeroDowntime?: boolean | 'unknown';
  /** Seconds of downtime on restart without zero-downtime. TODO(BEHAVIOR §8, T0.8): measure. */
  downtimeSec?: number;
}

export interface PowerExecOptions {
  /** HTTP readiness check after restart/start (e.g. a probe of the app URL). */
  probe?: () => Promise<boolean>;
  wait?: Pick<WaitOptions<unknown>, 'timeoutMs' | 'intervalMs' | 'sleep'>;
  now?: () => number;
}

export interface PowerResult {
  action: PowerAction;
  app: string;
  /** Always true when returned: the real state was observed, not just "accepted". */
  confirmed: true;
  elapsedMs: number;
  scale: number | undefined;
}

const TOOL: Record<PowerAction, string> = { restart: 'restart_app', start: 'start_app', stop: RISK_TOOLS.stopApp };

/** The approval card; `stop` is R2 and escalates to R3 for production / protected apps. */
export function planPower(action: PowerAction, app: string, ctx: Pick<OpsContext, 'risk'>, opts: PowerOptions = {}): ActionPlan {
  const p = fa.power;
  const downtime =
    action === 'stop' || opts.zeroDowntime === true ? [] : [opts.downtimeSec !== undefined && opts.zeroDowntime === false ? p.downtime(opts.downtimeSec) : p.downtimeUnknown];
  const by = {
    restart: { titleFa: p.restartTitle(app), impact: p.restartImpact, rollback: p.restartRollback, risk: Risk.R1, command: `POST /v1/projects/${app}/actions/restart`, params: { app } },
    start: { titleFa: p.startTitle(app), impact: p.startImpact, rollback: p.startRollback, risk: Risk.R1, command: `POST /v1/projects/${app}/actions/scale {scale: 1}`, params: { app, scale: 1 } },
    stop: { titleFa: p.stopTitle(app), impact: p.stopImpact, rollback: p.stopRollback, risk: Risk.R2, command: `POST /v1/projects/${app}/actions/scale {scale: 0}`, params: { app, scale: 0 } },
  }[action];
  return escalate(
    {
      id: newPlanId(TOOL[action]),
      toolName: TOOL[action],
      titleFa: by.titleFa,
      reasonFa: opts.reasonFa ?? p.defaultReason,
      target: { app },
      risk: by.risk,
      impactFa: [by.impact, ...downtime].join('\n'),
      rollbackFa: by.rollback,
      command: by.command,
      params: by.params,
      undo: action === 'restart' ? undefined : { tool: action === 'stop' ? TOOL.start : TOOL.stop, params: { app } },
    },
    ctx.risk ?? {},
  );
}

/** Runs the action and confirms the real state (accepted ≠ done, AGENT_RULES §1.10). */
export async function execPower(apps: AppsApi, action: PowerAction, app: string, opts: PowerExecOptions = {}): Promise<PowerResult> {
  const now = opts.now ?? Date.now;
  const started = now();
  const wait = opts.wait ?? {};
  let scale: number | undefined;
  if (action === 'stop') {
    await apps.setScale(app, 0);
    scale = (await waitAppScale(apps, app, 0, wait)).scale;
  } else {
    if (action === 'restart') await apps.restartApp(app);
    else await apps.setScale(app, 1);
    scale = (await waitAppRunning(apps, app, { ...wait, ...(opts.probe ? { probe: opts.probe } : {}) })).scale;
  }
  return { action, app, confirmed: true, elapsedMs: now() - started, scale };
}

/** `restart_app` / `start_app` / `stop_app` through the Safety Gate. */
export function powerApp(
  apps: AppsApi,
  action: PowerAction,
  app: string,
  ctx: OpsContext,
  opts: PowerOptions & PowerExecOptions = {},
): Promise<GuardResult<PowerResult>> {
  return guard(planPower(action, app, ctx, opts), ctx.approver, () => execPower(apps, action, app, opts), guardOptions(ctx));
}

// ---- resize (T6.3) ------------------------------------------------------------

export interface ResizeBackend {
  apps: Pick<AppsApi, 'getApp' | 'resizeApp' | 'findApp'>;
  billing: { getBilling(): Promise<{ balanceToman: number; minCreditThreshold?: number | undefined }> };
  catalog: PlanCatalog;
}

export interface ResizeOptions {
  reasonFa?: string;
  bundle?: Bundle;
  wait?: Pick<WaitOptions<unknown>, 'timeoutMs' | 'intervalMs' | 'sleep'>;
}

/** Card for `resize_app` (R2): current → new plan, monthly difference, reason, undo to the old plan. */
export function planResize(app: string, from: PlanEntry, to: PlanEntry, ctx: Pick<OpsContext, 'risk'>, opts: Pick<ResizeOptions, 'reasonFa' | 'bundle'> = {}): ActionPlan {
  const r = fa.resize;
  const diff = appMonthlyPrice(to, opts.bundle) - appMonthlyPrice(from, opts.bundle);
  const diffText = `${diff >= 0 ? '+' : '−'}${toman(Math.abs(diff))}`;
  return escalate(
    {
      id: newPlanId('resize_app'),
      toolName: 'resize_app',
      titleFa: r.title(app, from.id, to.id),
      reasonFa: opts.reasonFa ?? r.defaultReason,
      target: { app },
      risk: Risk.R2,
      costToman: { monthly: appMonthlyPrice(to, opts.bundle) },
      impactFa: r.impact(`${from.id} (${from.ramMb}MB, ${from.cpu} CPU)`, `${to.id} (${to.ramMb}MB, ${to.cpu} CPU)`, diffText),
      rollbackFa: r.rollback(from.id),
      command: `POST /v1/projects/${app}/resize {planID: ${to.id}}`,
      params: { app, planID: to.id },
      undo: { tool: 'resize_app', params: { app, planID: from.id } },
    },
    ctx.risk ?? {},
  );
}

/**
 * Loads both plans and checks the balance first (top-up is human-only, like T5.4): insufficient →
 * `LiaraApiError('INSUFFICIENT_BALANCE')` with the Persian top-up request; same plan → `no-change`.
 */
export async function prepareResize(
  b: ResizeBackend,
  app: string,
  targetPlanId: string,
  opts: Pick<ResizeOptions, 'bundle'> = {},
): Promise<{ status: 'ready'; from: PlanEntry; to: PlanEntry } | { status: 'no-change'; messageFa: string }> {
  const current = await b.apps.getApp(app, { fresh: true });
  const to = await b.catalog.requirePlan(targetPlanId);
  if (current.planID === to.id) return { status: 'no-change', messageFa: fa.resize.same(to.id) };
  const from = current.planID ? await b.catalog.planById(current.planID) : undefined;
  const billing = await b.billing.getBilling();
  const need = requiredBalance(appMonthlyPrice(to, opts.bundle), billing.minCreditThreshold ?? 0);
  if (billing.balanceToman < need) {
    throw new LiaraApiError(`insufficient balance for ${to.id}`, {
      code: 'INSUFFICIENT_BALANCE',
      messageFa: fa.planBilling.lowBalance(toman(billing.balanceToman), toman(need)),
      details: { balanceToman: billing.balanceToman, needToman: need, planID: to.id },
    });
  }
  // an unknown current plan (not in plan:list) still resizes; the card shows its id only
  return { status: 'ready', from: from ?? { ...to, id: current.planID ?? '?', ramMb: 0, cpu: 0, priceMonthlyToman: 0, bundlePricesToman: {} }, to };
}

/** Executes the resize and confirms the new plan in the app list (async action). */
export async function execResize(apps: Pick<AppsApi, 'resizeApp' | 'findApp'>, app: string, planId: string, opts: Pick<ResizeOptions, 'wait'> = {}): Promise<{ app: string; planID: string; confirmed: true }> {
  await apps.resizeApp(app, planId);
  await waitForState(() => apps.findApp(app, { fresh: true }), (a) => a?.planID === planId, opts.wait ?? {});
  return { app, planID: planId, confirmed: true };
}

export async function resizeApp(
  b: ResizeBackend,
  app: string,
  targetPlanId: string,
  ctx: OpsContext,
  opts: ResizeOptions = {},
): Promise<GuardResult<{ app: string; planID: string; confirmed: true }> | { status: 'no-change'; messageFa: string }> {
  const prep = await prepareResize(b, app, targetPlanId, opts);
  if (prep.status === 'no-change') return prep;
  return guard(planResize(app, prep.from, prep.to, ctx, opts), ctx.approver, (p) => execResize(b.apps, app, String(p.planID ?? targetPlanId), opts), guardOptions(ctx));
}
