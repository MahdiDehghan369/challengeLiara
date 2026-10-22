import { createHash, randomBytes } from 'node:crypto';
import { ApprovalDeniedError, isSiavashError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { applyPolicy, type Policy, type PolicyVerdict } from './policy.js';
import { Risk, type ActionPlan } from './risk.js';

/**
 * Approval Gate. Every state-changing Liara action runs through `guard()` (AGENT_RULES §1.7).
 * R0 runs directly; R1–R3 always ask an Approver; R3 is never session-approved; `--yes` never covers R2/R3.
 */

export type ApprovalDecision =
  | 'approved'
  /** Approve this and later identical-scope actions for the session. Honoured for R1 only. */
  | 'approved-session'
  | 'denied'
  | { edited: Record<string, unknown> }
  /** Two-step approval (MCP): nothing executes until the token comes back. */
  | { pending: { token: string; expiresAt: number } };

export interface ApprovalContext {
  /** MCP second step: the token returned by the first call. */
  confirmToken?: string;
}

export interface Approver {
  request(plan: ActionPlan, ctx?: ApprovalContext): Promise<ApprovalDecision>;
}

/** Headless default: refuses everything that needs approval. */
export class AutoDenyApprover implements Approver {
  async request(): Promise<ApprovalDecision> {
    return 'denied';
  }
}

/** `--yes`: approves R1 only; R2/R3 always need an explicit human decision. */
export class YesApprover implements Approver {
  constructor(private readonly fallback: Approver = new AutoDenyApprover()) {}

  async request(plan: ActionPlan, ctx?: ApprovalContext): Promise<ApprovalDecision> {
    return plan.risk === Risk.R1 ? 'approved' : this.fallback.request(plan, ctx);
  }
}

/** Test approver: returns scripted decisions in order and records the plans it saw. */
export class ScriptedApprover implements Approver {
  readonly seen: ActionPlan[] = [];
  private i = 0;

  constructor(private readonly decisions: ApprovalDecision[]) {}

  async request(plan: ActionPlan): Promise<ApprovalDecision> {
    this.seen.push(plan);
    const d = this.decisions[Math.min(this.i++, this.decisions.length - 1)];
    return d ?? 'denied';
  }
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'undefined';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

/** Hash binding an approval to the exact tool, target and params. */
export function planHash(plan: Pick<ActionPlan, 'toolName' | 'target' | 'params'>): string {
  return createHash('sha256')
    .update(stableStringify({ tool: plan.toolName, target: plan.target, params: plan.params }))
    .digest('hex');
}

export const MCP_TOKEN_TTL_MS = 5 * 60_000;

/** MCP two-step approval: `plan → confirm_token → execute`. Tokens expire in 5 min and are single-use. */
export class McpApprover implements Approver {
  private readonly pending = new Map<string, { hash: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  createPending(plan: ActionPlan): { token: string; expiresAt: number } {
    const token = randomBytes(18).toString('base64url');
    const expiresAt = this.now() + MCP_TOKEN_TTL_MS;
    this.pending.set(token, { hash: planHash(plan), expiresAt });
    return { token, expiresAt };
  }

  /** Validates and burns the token. Fails on unknown/expired/reused tokens or changed params. */
  consume(token: string, plan: ActionPlan): { ok: true } | { ok: false; reason: 'unknown' | 'expired' | 'mismatch' } {
    const p = this.pending.get(token);
    if (!p) return { ok: false, reason: 'unknown' };
    this.pending.delete(token);
    if (this.now() > p.expiresAt) return { ok: false, reason: 'expired' };
    if (p.hash !== planHash(plan)) return { ok: false, reason: 'mismatch' };
    return { ok: true };
  }

  async request(plan: ActionPlan, ctx?: ApprovalContext): Promise<ApprovalDecision> {
    if (!ctx?.confirmToken) return { pending: this.createPending(plan) };
    const r = this.consume(ctx.confirmToken, plan);
    if (!r.ok) {
      throw new ApprovalDeniedError(`MCP confirm token rejected: ${r.reason}`, {
        messageFa: fa.approval.tokenInvalid,
        details: { reason: r.reason, tool: plan.toolName },
      });
    }
    return 'approved';
  }
}

/** Remembers R1 session approvals per `toolName + app`. */
export class SessionApprovals {
  private readonly keys = new Set<string>();

  private key(plan: ActionPlan): string {
    return `${plan.toolName}::${plan.target.app ?? ''}`;
  }

  has(plan: ActionPlan): boolean {
    return plan.risk === Risk.R1 && this.keys.has(this.key(plan));
  }

  remember(plan: ActionPlan): void {
    if (plan.risk === Risk.R1) this.keys.add(this.key(plan));
  }
}

export type GuardDecision =
  | 'auto-r0'
  | 'approved'
  | 'approved-session'
  | 'session'
  | 'edited'
  | 'denied'
  | 'pending'
  | 'dry-run'
  /** Headless run allowed by the user policy (R0/R1 only). */
  | 'policy-headless';

/** What the gate reports for auditing; the Audit log (T2.4) implements the sink. */
export interface GuardAuditRecord {
  plan: ActionPlan;
  decision: GuardDecision;
  result: 'ok' | 'error' | 'dry-run' | 'denied' | 'pending';
  errorCode?: string;
  durationMs: number;
  actor: 'user' | 'agent' | 'runbook';
  sessionId: string;
}

export interface AuditSink {
  /** Return value is ignored by the gate (implementations may return the stored entry). */
  record(rec: GuardAuditRecord): unknown;
}

export interface GuardOptions {
  dryRun?: boolean;
  audit?: AuditSink;
  session?: SessionApprovals;
  sessionId?: string;
  actor?: 'user' | 'agent' | 'runbook';
  confirmToken?: string;
  /** Re-evaluates risk after the user edits params (normally `escalate` with context). */
  reassess?: (plan: ActionPlan) => ActionPlan;
  now?: () => number;
  /** User policy (T2.5), applied before asking. */
  policy?: Policy;
  /** No human available (CI / MCP without UI): only what the policy's `headless.allow` lists runs. */
  headless?: boolean;
}

export type GuardResult<T> =
  | { status: 'executed'; result: T; plan: ActionPlan; decision: GuardDecision }
  | { status: 'dry-run'; dryRun: true; plan: ActionPlan }
  | { status: 'pending'; plan: ActionPlan; token: string; expiresAt: number };

const MAX_EDIT_ROUNDS = 3;

export async function guard<T>(
  plan: ActionPlan,
  approver: Approver,
  exec: (params: Record<string, unknown>) => Promise<T>,
  opts: GuardOptions = {},
): Promise<GuardResult<T>> {
  const now = opts.now ?? Date.now;
  const started = now();
  const actor = opts.actor ?? 'agent';
  const sessionId = opts.sessionId ?? 'default';
  const audit = async (p: ActionPlan, decision: GuardDecision, result: GuardAuditRecord['result'], errorCode?: string) => {
    await opts.audit?.record({
      plan: p,
      decision,
      result,
      ...(errorCode ? { errorCode } : {}),
      durationMs: now() - started,
      actor,
      sessionId,
    });
  };

  if (opts.dryRun) {
    await audit(plan, 'dry-run', 'dry-run');
    return { status: 'dry-run', dryRun: true, plan };
  }

  let current = plan;
  let decision: GuardDecision;
  const allowSession = opts.policy?.allowSessionApprove ?? true;
  const policyDeny = async (v: Extract<PolicyVerdict, { kind: 'deny' }>): Promise<never> => {
    await audit(v.plan, 'denied', 'denied', v.code);
    throw new ApprovalDeniedError(`Action denied by policy (${v.code}): ${v.plan.toolName}`, {
      messageFa: v.messageFa,
      details: { tool: v.plan.toolName, risk: v.plan.risk, target: v.plan.target, policy: v.code },
    });
  };
  let verdict: PolicyVerdict['kind'] = 'ask';
  if (opts.policy) {
    const v = applyPolicy(current, opts.policy, opts.headless ? { headless: true } : {});
    if (v.kind === 'deny') await policyDeny(v);
    current = v.plan;
    verdict = v.kind;
  }
  if (current.risk === Risk.R0) {
    decision = 'auto-r0';
  } else if (verdict === 'allow') {
    decision = 'policy-headless';
  } else if (allowSession && opts.session?.has(current)) {
    decision = 'session';
  } else {
    decision = 'denied';
    for (let round = 0; round < MAX_EDIT_ROUNDS; round++) {
      let d: ApprovalDecision;
      try {
        d = await approver.request(current, opts.confirmToken ? { confirmToken: opts.confirmToken } : {});
      } catch (e) {
        await audit(current, 'denied', 'denied', isSiavashError(e) ? e.code : 'APPROVER_ERROR');
        throw e;
      }
      if (d === 'approved') {
        decision = 'approved';
      } else if (d === 'approved-session') {
        // policy may disable session approvals: then it counts once
        decision = allowSession ? 'approved-session' : 'approved';
        if (allowSession) opts.session?.remember(current);
      } else if (d === 'denied') {
        decision = 'denied';
      } else if ('pending' in d) {
        await audit(current, 'pending', 'pending');
        return { status: 'pending', plan: current, token: d.pending.token, expiresAt: d.pending.expiresAt };
      } else {
        const edited = { ...current, params: d.edited };
        const reassessed = opts.reassess ? opts.reassess(edited) : edited;
        // raised risk after editing → ask again for the new plan
        if (reassessed.risk > current.risk) {
          current = reassessed;
          continue;
        }
        current = { ...reassessed, risk: Math.max(reassessed.risk, current.risk) as Risk };
        decision = 'edited';
      }
      break;
    }
  }

  // edited params may change the cost: the cap still applies
  if (opts.policy && decision === 'edited') {
    const v = applyPolicy(current, opts.policy);
    if (v.kind === 'deny') await policyDeny(v);
    current = v.plan;
  }

  if (decision === 'denied') {
    await audit(current, 'denied', 'denied', 'APPROVAL_DENIED');
    throw new ApprovalDeniedError(`Action denied: ${current.toolName}`, {
      messageFa: fa.approval.denied(current.titleFa),
      details: { tool: current.toolName, risk: current.risk, target: current.target },
    });
  }

  try {
    const result = await exec(current.params);
    await audit(current, decision, 'ok');
    return { status: 'executed', result, plan: current, decision };
  } catch (e) {
    await audit(current, decision, 'error', isSiavashError(e) ? e.code : 'ERROR');
    throw e;
  }
}
