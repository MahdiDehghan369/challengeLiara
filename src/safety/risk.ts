/**
 * Risk model (01-ANALYSIS §4).
 * R0 read-only · R1 reversible change · R2 cost / significant effect · R3 destructive / irreversible.
 */
export enum Risk {
  R0 = 0,
  R1 = 1,
  R2 = 2,
  R3 = 3,
}

export function riskLabel(r: Risk): 'R0' | 'R1' | 'R2' | 'R3' {
  return `R${r}` as 'R0' | 'R1' | 'R2' | 'R3';
}

export function maxRisk(a: Risk, b: Risk): Risk {
  return a >= b ? a : b;
}

export interface ActionPlan {
  id: string;
  toolName: string;
  titleFa: string;
  reasonFa: string;
  target: { app?: string; resource?: string };
  risk: Risk;
  costToman?: { monthly?: number; oneTime?: number };
  impactFa: string;
  rollbackFa: string;
  /** Exact API/CLI call shown to the user, already redacted, e.g. `POST /v1/projects/my-app/actions/restart`. */
  command: string;
  params: Record<string, unknown>;
  /** Codes of the escalation rules that raised the risk (filled by `escalate`). */
  escalations?: EscalationCode[];
}

/** Tool names the escalation rules recognise; the Tool Registry (T3.3) must use the same names. */
export const RISK_TOOLS = {
  stopApp: 'stop_app',
  scaleApp: 'scale_app',
  setEnv: 'set_env',
  unsetEnv: 'unset_env',
  setFixedIp: 'set_fixed_ip',
} as const;

export type EscalationCode =
  | 'STOP_PROTECTED_APP'
  | 'SECRET_ENV'
  | 'ENV_REPLACE_REMOVES_VARS'
  | 'FIXED_IP_COST';

export interface RiskContext {
  /** Apps marked production. */
  productionApps?: string[];
  /** Apps from the user policy (`protectedApps`). */
  protectedApps?: string[];
  /** update-envs semantics (BEHAVIOR §2 / OQ-19). */
  envSemantics?: 'replace' | 'merge' | 'unknown';
}

const SECRET_ENV_PATTERNS = [/_KEY$/i, /_SECRET$/i, /PASSWORD/i, /TOKEN/i, /^DATABASE_URL$/i, /_URI$/i];

export function isSecretEnvName(key: string): boolean {
  return SECRET_ENV_PATTERNS.some((re) => re.test(key));
}

function envKeys(params: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const vars = params.vars;
  if (vars && typeof vars === 'object' && !Array.isArray(vars)) keys.push(...Object.keys(vars));
  if (Array.isArray(params.keys)) keys.push(...params.keys.filter((k): k is string => typeof k === 'string'));
  if (typeof params.key === 'string') keys.push(params.key);
  return keys;
}

function isStopAction(plan: ActionPlan): boolean {
  if (plan.toolName === RISK_TOOLS.stopApp) return true;
  return plan.toolName === RISK_TOOLS.scaleApp && Number(plan.params.scale) === 0;
}

function isEnable(v: unknown): boolean {
  return v === true || v === 'enable' || v === 'on';
}

/** Raises (never lowers) the plan's risk according to context. Returns a new plan with `escalations`. */
export function escalate(plan: ActionPlan, ctx: RiskContext = {}): ActionPlan {
  let risk = plan.risk;
  const codes: EscalationCode[] = [...(plan.escalations ?? [])];
  const add = (r: Risk, code: EscalationCode) => {
    risk = maxRisk(risk, r);
    if (!codes.includes(code)) codes.push(code);
  };
  const app = plan.target.app;
  const sensitiveApp =
    app !== undefined && ((ctx.productionApps ?? []).includes(app) || (ctx.protectedApps ?? []).includes(app));

  if (isStopAction(plan) && sensitiveApp) add(Risk.R3, 'STOP_PROTECTED_APP');

  if (plan.toolName === RISK_TOOLS.setEnv || plan.toolName === RISK_TOOLS.unsetEnv) {
    if (envKeys(plan.params).some(isSecretEnvName)) add(Risk.R2, 'SECRET_ENV');
    const removed = Number(plan.params.removedCount ?? (plan.toolName === RISK_TOOLS.unsetEnv ? envKeys(plan.params).length : 0));
    if (ctx.envSemantics === 'replace' && removed > 0) add(Risk.R3, 'ENV_REPLACE_REMOVES_VARS');
  }

  if (plan.toolName === RISK_TOOLS.setFixedIp && isEnable(plan.params.on ?? plan.params.status)) {
    add(Risk.R2, 'FIXED_IP_COST');
  }

  return { ...plan, risk, escalations: codes };
}
