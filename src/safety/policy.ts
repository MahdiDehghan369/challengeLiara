import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ValidationError } from '../shared/errors.js';
import { toman } from '../ui/cli/format.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { Risk, maxRisk, riskLabel, type ActionPlan, type RiskContext } from './risk.js';

/**
 * User policy (T2.5), applied by the gate before any approval is requested.
 * It can only make the gate stricter: raise risk, deny without asking, or let R0/R1 run headless.
 */
export const PolicySchema = z.object({
  /** Everything targeting these apps is at least R2 (stopping them is R3 via `escalate`). */
  protectedApps: z.array(z.string().min(1)).default([]),
  /** Actions whose monthly cost exceeds this are denied without asking. */
  maxMonthlyCostToman: z.number().nonnegative().optional(),
  /** When false, "approve for this session" acts as a one-time approval. */
  allowSessionApprove: z.boolean().default(true),
  /** Risk levels that may run without a human in headless mode. R2/R3 can never be listed. */
  headless: z.object({ allow: z.array(z.enum(['R0', 'R1'])).default(['R0']) }).default({ allow: ['R0'] }),
});

export type Policy = z.infer<typeof PolicySchema>;

export const DEFAULT_POLICY_PATH = 'siavash.policy.yaml';
export const DEFAULT_POLICY: Policy = PolicySchema.parse({});

export function parsePolicy(raw: unknown): Policy {
  const parsed = PolicySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ValidationError('Invalid policy file', {
      messageFa: fa.approval.invalidPolicy,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  return parsed.data;
}

/** Reads the policy YAML; a missing file means the defaults. */
export function loadPolicy(path: string = DEFAULT_POLICY_PATH): Policy {
  const p = resolve(path);
  if (!existsSync(p)) return DEFAULT_POLICY;
  let raw: unknown;
  try {
    raw = parseYaml(readFileSync(p, 'utf8'));
  } catch (cause) {
    throw new ValidationError('Policy file is not valid YAML', { messageFa: fa.approval.invalidPolicy, cause });
  }
  return parsePolicy(raw);
}

/** Context for `escalate` derived from the policy. */
export function policyRiskContext(policy: Policy): Pick<RiskContext, 'protectedApps'> {
  return { protectedApps: policy.protectedApps };
}

export type PolicyVerdict =
  | { kind: 'ask'; plan: ActionPlan }
  /** Headless and allowed by policy: run without asking. */
  | { kind: 'allow'; plan: ActionPlan }
  | { kind: 'deny'; plan: ActionPlan; code: 'POLICY_COST_CAP' | 'POLICY_HEADLESS'; messageFa: string };

export function applyPolicy(plan: ActionPlan, policy: Policy, opts: { headless?: boolean } = {}): PolicyVerdict {
  let p = plan;
  const app = p.target.app;
  if (app !== undefined && p.risk > Risk.R0 && policy.protectedApps.includes(app)) {
    p = { ...p, risk: maxRisk(p.risk, Risk.R2) };
  }

  const monthly = p.costToman?.monthly;
  if (policy.maxMonthlyCostToman !== undefined && monthly !== undefined && monthly > policy.maxMonthlyCostToman) {
    return {
      kind: 'deny',
      plan: p,
      code: 'POLICY_COST_CAP',
      messageFa: fa.approval.costCap(toman(monthly), toman(policy.maxMonthlyCostToman)),
    };
  }

  if (opts.headless && p.risk > Risk.R0) {
    const label = riskLabel(p.risk);
    if ((policy.headless.allow as string[]).includes(label)) return { kind: 'allow', plan: p };
    return { kind: 'deny', plan: p, code: 'POLICY_HEADLESS', messageFa: fa.approval.headlessNotAllowed(label) };
  }
  return { kind: 'ask', plan: p };
}
