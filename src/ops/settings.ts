import type { Domain, SettingName, SettingResult } from '../liara/index.js';
import { guard, type GuardResult } from '../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../safety/risk.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { guardOptions, newPlanId, type OpsContext } from './context.js';

/** The settings backend (implemented by `SettingsApi`, T1.9). */
export interface SettingsBackend {
  setZeroDowntime(name: string, on: boolean): Promise<SettingResult>;
  setDefaultSubdomain(name: string, on: boolean): Promise<SettingResult>;
  setFixedIp(name: string, on: boolean): Promise<SettingResult & { ip: string | undefined }>;
  setReadOnly(name: string, on: boolean): Promise<SettingResult>;
}

export interface DomainsLookup {
  listDomains(app: string): Promise<Domain[]>;
}

export interface MountsLookup {
  listDisks(app: string): Promise<{ mounts: Array<{ name: string; mountedTo: string }> }>;
}

type Key = 'zeroDowntime' | 'defaultSubdomain' | 'fixedIp' | 'readOnly';

const TOOL: Record<Key, string> = {
  zeroDowntime: 'set_zero_downtime',
  defaultSubdomain: 'set_default_subdomain',
  fixedIp: 'set_fixed_ip',
  readOnly: 'set_read_only',
};

const ROUTE: Record<Key, SettingName> = {
  zeroDowntime: 'zero-downtime',
  defaultSubdomain: 'default-subdomain',
  fixedIp: 'fixed-ip',
  readOnly: 'read-only',
};

function buildPlan(key: Key, app: string, on: boolean, risk: Risk, extraFa: string[], ctx: OpsContext, reasonFa?: string): ActionPlan {
  const s = fa.opsSettings;
  const impact = s.impact[`${key}${on ? 'On' : 'Off'}` as keyof typeof s.impact];
  return escalate(
    {
      id: newPlanId(TOOL[key]),
      toolName: TOOL[key],
      titleFa: s.title(s.names[key], on ? s.on : s.off),
      reasonFa: reasonFa ?? s.defaultReason,
      target: { app },
      risk,
      impactFa: [impact, ...extraFa].join('\n'),
      rollbackFa: s.rollback(on ? s.off : s.on),
      command: `POST /v1/projects/{id}/${ROUTE[key]}/${on ? 'enable' : 'disable'}`,
      params: { app, on, status: on ? 'enable' : 'disable' },
    },
    ctx.risk ?? {},
  );
}

const onOf = (p: Record<string, unknown>, fallback: boolean) => (typeof p.on === 'boolean' ? p.on : fallback);

/** `set_zero_downtime` (R1). */
export function setZeroDowntime(
  api: SettingsBackend,
  app: string,
  on: boolean,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<SettingResult>> {
  const plan = buildPlan('zeroDowntime', app, on, Risk.R1, [], ctx, opts.reasonFa);
  return guard(plan, ctx.approver, (p) => api.setZeroDowntime(app, onOf(p, on)), guardOptions(ctx));
}

/** `set_default_subdomain` (R1); disabling it with no custom domain takes the app offline → R2 + warning. */
export async function setDefaultSubdomain(
  api: SettingsBackend,
  domains: DomainsLookup,
  app: string,
  on: boolean,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<SettingResult>> {
  let risk = Risk.R1;
  const extra: string[] = [];
  if (!on && (await domains.listDomains(app)).length === 0) {
    risk = Risk.R2;
    extra.push(fa.opsSettings.noCustomDomainWarning);
  }
  const plan = buildPlan('defaultSubdomain', app, on, risk, extra, ctx, opts.reasonFa);
  return guard(plan, ctx.approver, (p) => api.setDefaultSubdomain(app, onOf(p, on)), guardOptions(ctx));
}

/** `set_fixed_ip` (R2: monthly cost when enabled; disabling can break IP whitelists). */
export function setFixedIp(
  api: SettingsBackend,
  app: string,
  on: boolean,
  ctx: OpsContext,
  opts: { reasonFa?: string; monthlyCostToman?: number } = {},
): Promise<GuardResult<SettingResult & { ip: string | undefined }>> {
  const base = buildPlan('fixedIp', app, on, Risk.R2, [], ctx, opts.reasonFa);
  const plan = on && opts.monthlyCostToman !== undefined ? { ...base, costToman: { monthly: opts.monthlyCostToman } } : base;
  return guard(plan, ctx.approver, (p) => api.setFixedIp(app, onOf(p, on)), guardOptions(ctx));
}

/**
 * `set_read_only` (R1). Warns when the app has mounted disks or is known to write locally
 * (`writesTo`, e.g. from the analyzer: `['/tmp', 'uploads/']`).
 */
export async function setReadOnly(
  api: SettingsBackend,
  app: string,
  on: boolean,
  ctx: OpsContext,
  opts: { reasonFa?: string; mounts?: MountsLookup; writesTo?: string[] } = {},
): Promise<GuardResult<SettingResult>> {
  const extra: string[] = [];
  if (on) {
    const where = [...(opts.writesTo ?? [])];
    if (opts.mounts) {
      const { mounts } = await opts.mounts.listDisks(app).catch(() => ({ mounts: [] }));
      where.push(...mounts.map((m) => m.mountedTo));
    }
    if (where.length > 0) extra.push(fa.opsSettings.readOnlyWritesWarning([...new Set(where)].join(', ')));
  }
  const plan = buildPlan('readOnly', app, on, Risk.R1, extra, ctx, opts.reasonFa);
  return guard(plan, ctx.approver, (p) => api.setReadOnly(app, onOf(p, on)), guardOptions(ctx));
}
