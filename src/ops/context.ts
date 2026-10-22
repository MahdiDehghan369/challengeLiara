import { createHmac, randomBytes } from 'node:crypto';
import type { Approver, AuditSink, GuardOptions, SessionApprovals } from '../safety/approval.js';
import { escalate, type ActionPlan, type RiskContext } from '../safety/risk.js';

/** Everything an ops action needs to go through the Safety Gate. */
export interface OpsContext {
  approver: Approver;
  audit?: AuditSink;
  session?: SessionApprovals;
  sessionId?: string;
  actor?: 'user' | 'agent' | 'runbook';
  dryRun?: boolean;
  /** MCP second step. */
  confirmToken?: string;
  risk?: RiskContext;
}

export function guardOptions(ctx: OpsContext): GuardOptions {
  return {
    ...(ctx.audit ? { audit: ctx.audit } : {}),
    ...(ctx.session ? { session: ctx.session } : {}),
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.actor ? { actor: ctx.actor } : {}),
    ...(ctx.dryRun ? { dryRun: true } : {}),
    ...(ctx.confirmToken ? { confirmToken: ctx.confirmToken } : {}),
    reassess: (p: ActionPlan) => escalate(p, ctx.risk ?? {}),
  };
}

const FINGERPRINT_KEY = randomBytes(32);

/**
 * Per-process keyed fingerprint of a secret value. Lets plan params (hashed for MCP tokens, written
 * to the audit log) bind to exact values without containing or leaking them.
 */
export function fingerprint(value: string): string {
  return `fp:${createHmac('sha256', FINGERPRINT_KEY).update(value).digest('hex').slice(0, 16)}`;
}

let planSeq = 0;
export function newPlanId(prefix: string): string {
  planSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${planSeq}`;
}
