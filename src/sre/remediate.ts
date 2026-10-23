import type { PlanEntry } from '../planner/plans.js';
import { isSecretEnvName, Risk } from '../safety/risk.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { ActionType } from './knowledge/index.js';
import type { Hypothesis, ProposedFix, RcaResult } from './rca.js';

/**
 * Remediation planner (T8.6): turns `proposedFixes` into executable options mapped to existing tools,
 * ordered least-risky-effective first, and always offers two separate tracks: a quick fix (rollback,
 * restart, resize…) and a root fix (code patch, env, config…). `manual` gets Persian step-by-step
 * instructions. Execution itself still goes through the tool registry / Safety Gate (T8.11).
 */

export type RemediationTool =
  | 'set_env'
  | 'restart_app'
  | 'resize_app'
  | 'rollback_app'
  | 'redeploy_app'
  | 'code_patch'
  | 'set_read_only'
  | 'create_disk'
  | 'run_migration'
  | 'manual';

export interface RemediationOption {
  hypothesisId: string;
  confidence: number;
  tool: RemediationTool;
  risk: Risk;
  kind: 'quick' | 'root';
  titleFa: string;
  expectedEffectFa: string;
  /** Tool arguments known now; `needsInput` lists what the user must still provide. */
  args: Record<string, string | number | boolean>;
  needsInput: string[];
  /** Persian steps for `manual`. */
  manualStepsFa?: string[];
}

export interface RemediationPlan {
  quickFix: RemediationOption | undefined;
  rootFix: RemediationOption | undefined;
  /** All options, least risky first, then by confidence. */
  options: RemediationOption[];
}

export interface RemediationContext {
  app: string;
  /** For resize targets: the current plan and the catalog (sorted by price). */
  currentPlan?: PlanEntry;
  plans?: PlanEntry[];
  /** A previous healthy deployment exists (rollback possible). */
  hasHealthyPrevious?: boolean;
}

const QUICK = new Set<RemediationTool>(['rollback_app', 'restart_app', 'resize_app', 'redeploy_app']);

const RISK: Record<RemediationTool, Risk> = {
  manual: Risk.R0,
  restart_app: Risk.R1,
  redeploy_app: Risk.R1,
  set_read_only: Risk.R1,
  set_env: Risk.R1,
  resize_app: Risk.R2,
  rollback_app: Risk.R2,
  code_patch: Risk.R2,
  create_disk: Risk.R2,
  run_migration: Risk.R2,
};

function toolFor(a: ActionType): RemediationTool {
  if (a === 'config_file') return 'code_patch';
  if (a === 'run_in_container') return 'run_migration';
  return a;
}

function nextPlanUp(ctx: RemediationContext): PlanEntry | undefined {
  if (!ctx.currentPlan || !ctx.plans) return undefined;
  const cur = ctx.currentPlan;
  return ctx.plans.filter((p) => p.available && p.ramMb > cur.ramMb).sort((a, b) => a.priceMonthlyToman - b.priceMonthlyToman)[0];
}

export function manualSteps(h: Hypothesis, fix: Pick<ProposedFix, 'expectedEffectFa'>): string[] {
  const r = fa.remediate;
  return [r.manualIntro, r.manualStep(1, h.explanationFa), r.manualStep(2, fix.expectedEffectFa), r.manualCheck(h.howToVerifyFa), r.manualAsk];
}

function option(h: Hypothesis, fix: ProposedFix, ctx: RemediationContext): RemediationOption {
  const r = fa.remediate;
  const tool = toolFor(fix.actionType);
  const args: Record<string, string | number | boolean> = { app: ctx.app };
  const needsInput: string[] = [];
  let label = '';
  let risk = RISK[tool];
  switch (tool) {
    case 'set_env': {
      const name = typeof fix.params?.name === 'string' ? fix.params.name : undefined;
      if (name) args.name = name;
      else needsInput.push('name');
      needsInput.push('value');
      // secret names are escalated to R2 by the gate; show it here too
      if (name && isSecretEnvName(name)) risk = Risk.R2;
      label = name ?? '?';
      break;
    }
    case 'resize_app': {
      const target = typeof fix.params?.planID === 'string' ? fix.params.planID : nextPlanUp(ctx)?.id;
      if (target) args.planID = target;
      else needsInput.push('planID');
      label = target ?? r.choosePlan;
      break;
    }
    case 'rollback_app':
      args.to = 'last-healthy';
      break;
    case 'set_read_only':
      args.on = fix.params?.on ?? false;
      break;
    default:
      for (const [k, v] of Object.entries(fix.params ?? {})) if (k !== 'direction') args[k] = v;
  }
  return {
    hypothesisId: h.id,
    confidence: h.confidence,
    tool,
    risk,
    kind: QUICK.has(tool) ? 'quick' : 'root',
    titleFa: (r.action[tool] ?? r.action.manual!)(label),
    expectedEffectFa: fix.expectedEffectFa,
    args,
    needsInput,
    ...(tool === 'manual' ? { manualStepsFa: manualSteps(h, fix) } : {}),
  };
}

export function planRemediation(rca: Pick<RcaResult, 'hypotheses'>, ctx: RemediationContext): RemediationPlan {
  const options: RemediationOption[] = [];
  for (const h of rca.hypotheses) {
    for (const fix of h.proposedFixes) {
      const o = option(h, fix, ctx);
      // a rollback needs a healthy previous version
      if (o.tool === 'rollback_app' && ctx.hasHealthyPrevious === false) continue;
      if (!options.some((x) => x.tool === o.tool && JSON.stringify(x.args) === JSON.stringify(o.args))) options.push(o);
    }
  }
  // least risky effective first: risk, then the confidence of the hypothesis behind it
  options.sort((a, b) => a.risk - b.risk || b.confidence - a.confidence);

  const top = rca.hypotheses[0];
  const forTop = (kind: 'quick' | 'root') => options.find((o) => o.kind === kind && o.hypothesisId === top?.id && o.tool !== 'manual');
  let quickFix = forTop('quick') ?? options.find((o) => o.kind === 'quick');
  let rootFix = forTop('root') ?? options.find((o) => o.kind === 'root' && o.tool !== 'manual') ?? options.find((o) => o.tool === 'manual');

  // always two tracks: fall back to a generic quick fix and to manual steps for the root cause
  if (!quickFix && top) {
    const generic: ProposedFix =
      ctx.hasHealthyPrevious
        ? { actionType: 'rollback_app', expectedEffectFa: fa.rca.effect.rollback_app! }
        : { actionType: 'restart_app', expectedEffectFa: fa.rca.effect.restart_app! };
    quickFix = option(top, generic, ctx);
    options.push(quickFix);
  }
  if (!rootFix && top) {
    rootFix = option(top, { actionType: 'manual', expectedEffectFa: fa.rca.effect.manual! }, ctx);
    options.push(rootFix);
  }
  return { quickFix, rootFix, options };
}
