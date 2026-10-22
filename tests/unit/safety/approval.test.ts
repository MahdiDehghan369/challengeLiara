import { describe, expect, it } from 'vitest';
import {
  AutoDenyApprover,
  guard,
  McpApprover,
  MCP_TOKEN_TTL_MS,
  planHash,
  ScriptedApprover,
  SessionApprovals,
  YesApprover,
  type ApprovalDecision,
  type GuardAuditRecord,
} from '../../../src/safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../../../src/safety/risk.js';
import { ApprovalDeniedError } from '../../../src/shared/errors.js';

const plan = (risk: Risk, over: Partial<ActionPlan> = {}): ActionPlan => ({
  id: 'p',
  toolName: 'restart_app',
  titleFa: 'ری‌استارت',
  reasonFa: 'r',
  target: { app: 'shop' },
  risk,
  impactFa: 'i',
  rollbackFa: 'b',
  command: 'POST /v1/projects/shop/actions/restart',
  params: { a: 1 },
  ...over,
});

function harness() {
  const audit: GuardAuditRecord[] = [];
  const execCalls: Array<Record<string, unknown>> = [];
  const exec = async (params: Record<string, unknown>) => {
    execCalls.push(params);
    return 'done';
  };
  return { audit, sink: { record: (r: GuardAuditRecord) => void audit.push(r) }, exec, execCalls };
}

const RISKS = [Risk.R1, Risk.R2, Risk.R3];

describe('guard: risk × decision matrix', () => {
  it('R0 runs without asking the approver', async () => {
    const h = harness();
    const approver = new ScriptedApprover(['denied']);
    const r = await guard(plan(Risk.R0), approver, h.exec, { audit: h.sink });
    expect(r.status).toBe('executed');
    expect(approver.seen).toHaveLength(0);
    expect(h.audit[0]).toMatchObject({ decision: 'auto-r0', result: 'ok' });
  });

  for (const risk of RISKS) {
    it(`R${risk} approved → executes once, audited`, async () => {
      const h = harness();
      const approver = new ScriptedApprover(['approved']);
      const r = await guard(plan(risk), approver, h.exec, { audit: h.sink });
      expect(r).toMatchObject({ status: 'executed', result: 'done', decision: 'approved' });
      expect(approver.seen).toHaveLength(1);
      expect(h.execCalls).toEqual([{ a: 1 }]);
      expect(h.audit).toHaveLength(1);
      expect(h.audit[0]).toMatchObject({ result: 'ok', decision: 'approved' });
    });

    it(`R${risk} denied → ApprovalDeniedError, not executed, audited`, async () => {
      const h = harness();
      await expect(guard(plan(risk), new ScriptedApprover(['denied']), h.exec, { audit: h.sink })).rejects.toBeInstanceOf(
        ApprovalDeniedError,
      );
      expect(h.execCalls).toEqual([]);
      expect(h.audit[0]).toMatchObject({ decision: 'denied', result: 'denied', errorCode: 'APPROVAL_DENIED' });
    });

    it(`R${risk} edited → executes with edited params`, async () => {
      const h = harness();
      const r = await guard(plan(risk), new ScriptedApprover([{ edited: { a: 2 } }]), h.exec, { audit: h.sink });
      expect(r).toMatchObject({ status: 'executed', decision: 'edited' });
      expect(h.execCalls).toEqual([{ a: 2 }]);
    });

    it(`R${risk} with AutoDenyApprover never executes`, async () => {
      const h = harness();
      await expect(guard(plan(risk), new AutoDenyApprover(), h.exec)).rejects.toBeInstanceOf(ApprovalDeniedError);
      expect(h.execCalls).toEqual([]);
    });
  }

  it('exec failure is audited as error and rethrown', async () => {
    const h = harness();
    await expect(
      guard(plan(Risk.R1), new ScriptedApprover(['approved']), async () => {
        throw new Error('boom');
      }, { audit: h.sink }),
    ).rejects.toThrow('boom');
    expect(h.audit[0]).toMatchObject({ result: 'error', errorCode: 'ERROR' });
  });
});

describe('session approval', () => {
  it('R1 "approved-session" skips later approvals for the same tool + app only', async () => {
    const h = harness();
    const session = new SessionApprovals();
    const approver = new ScriptedApprover(['approved-session', 'approved']);
    await guard(plan(Risk.R1), approver, h.exec, { session, audit: h.sink });
    const second = await guard(plan(Risk.R1), approver, h.exec, { session, audit: h.sink });
    expect(second).toMatchObject({ decision: 'session' });
    expect(approver.seen).toHaveLength(1);
    await guard(plan(Risk.R1, { target: { app: 'other' } }), approver, h.exec, { session });
    expect(approver.seen).toHaveLength(2);
  });

  it.each([Risk.R2, Risk.R3])('R%s is never session-approved', async (risk) => {
    const h = harness();
    const session = new SessionApprovals();
    const approver = new ScriptedApprover(['approved-session', 'denied']);
    await guard(plan(risk), approver, h.exec, { session });
    await expect(guard(plan(risk), approver, h.exec, { session })).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(approver.seen).toHaveLength(2);
    expect(h.execCalls).toHaveLength(1);
  });
});

describe('YesApprover (--yes)', () => {
  it('approves R1 only; R2/R3 fall through to the fallback (deny by default)', async () => {
    const yes = new YesApprover();
    expect(await yes.request(plan(Risk.R1))).toBe('approved');
    expect(await yes.request(plan(Risk.R2))).toBe('denied');
    expect(await yes.request(plan(Risk.R3))).toBe('denied');
  });
});

describe('edited params re-assessment', () => {
  it('editing into a riskier plan asks again with the new risk', async () => {
    const h = harness();
    const approver = new ScriptedApprover([{ edited: { vars: { API_KEY: 'x' } } }, 'approved']);
    const p = plan(Risk.R1, { toolName: 'set_env', params: { vars: { APP_NAME: 'x' } } });
    const r = await guard(p, approver, h.exec, { reassess: (x) => escalate(x) });
    expect(approver.seen.map((s) => s.risk)).toEqual([Risk.R1, Risk.R2]);
    expect(r).toMatchObject({ status: 'executed', decision: 'approved' });
    expect(h.execCalls).toEqual([{ vars: { API_KEY: 'x' } }]);
  });
});

describe('dry-run', () => {
  it('never executes nor asks; audited as dry-run', async () => {
    const h = harness();
    const approver = new ScriptedApprover(['approved']);
    const r = await guard(plan(Risk.R3), approver, h.exec, { dryRun: true, audit: h.sink });
    expect(r).toEqual({ status: 'dry-run', dryRun: true, plan: plan(Risk.R3) });
    expect(approver.seen).toHaveLength(0);
    expect(h.execCalls).toEqual([]);
    expect(h.audit[0]).toMatchObject({ decision: 'dry-run', result: 'dry-run' });
  });
});

describe('McpApprover (two-step)', () => {
  function mcp() {
    let t = 1_000_000;
    const a = new McpApprover(() => t);
    return { a, advance: (ms: number) => (t += ms) };
  }

  it('first call returns a pending token without executing; second call with token executes', async () => {
    const h = harness();
    const { a } = mcp();
    const p = plan(Risk.R2);
    const first = await guard(p, a, h.exec, { audit: h.sink });
    expect(first.status).toBe('pending');
    expect(h.execCalls).toEqual([]);
    if (first.status !== 'pending') return;
    const second = await guard(p, a, h.exec, { confirmToken: first.token, audit: h.sink });
    expect(second.status).toBe('executed');
    expect(h.execCalls).toHaveLength(1);
    expect(h.audit.map((x) => x.result)).toEqual(['pending', 'ok']);
  });

  it('token is single-use', async () => {
    const { a } = mcp();
    const p = plan(Risk.R1);
    const { token } = a.createPending(p);
    expect(a.consume(token, p)).toEqual({ ok: true });
    expect(a.consume(token, p)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('token expires after 5 minutes', () => {
    const { a, advance } = mcp();
    const p = plan(Risk.R1);
    const { token } = a.createPending(p);
    advance(MCP_TOKEN_TTL_MS + 1);
    expect(a.consume(token, p)).toEqual({ ok: false, reason: 'expired' });
  });

  it('token is rejected when params change', async () => {
    const h = harness();
    const { a } = mcp();
    const { token } = a.createPending(plan(Risk.R3, { params: { name: 'shop' } }));
    await expect(
      guard(plan(Risk.R3, { params: { name: 'other' } }), a, h.exec, { confirmToken: token, audit: h.sink }),
    ).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(h.execCalls).toEqual([]);
    expect(h.audit[0]).toMatchObject({ result: 'denied' });
  });

  it('planHash is key-order independent', () => {
    const p1 = plan(Risk.R1, { params: { a: 1, b: { c: 2, d: 3 } } });
    const p2 = plan(Risk.R1, { params: { b: { d: 3, c: 2 }, a: 1 } });
    expect(planHash(p1)).toBe(planHash(p2));
  });
});

describe('no bypass', () => {
  it('every non-R0 risk consults the approver exactly once per call', async () => {
    for (const risk of RISKS) {
      const decisions: ApprovalDecision[] = ['approved'];
      const approver = new ScriptedApprover(decisions);
      await guard(plan(risk), approver, async () => 1);
      expect(approver.seen).toHaveLength(1);
    }
  });
});
