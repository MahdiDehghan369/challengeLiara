import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { guard, ScriptedApprover, SessionApprovals, type GuardAuditRecord } from '../../../src/safety/approval.js';
import { applyPolicy, DEFAULT_POLICY, loadPolicy, parsePolicy } from '../../../src/safety/policy.js';
import { Risk, type ActionPlan } from '../../../src/safety/risk.js';
import { ApprovalDeniedError, ValidationError } from '../../../src/shared/errors.js';

const plan = (risk: Risk, over: Partial<ActionPlan> = {}): ActionPlan => ({
  id: 'p1',
  toolName: 'resize_app',
  titleFa: 'تغییر پلن',
  reasonFa: 'کمبود حافظه',
  target: { app: 'shop' },
  risk,
  impactFa: 'ری‌استارت کوتاه',
  rollbackFa: 'برگشت به پلن قبلی',
  command: 'POST /v1/projects/shop/actions/resize',
  params: { planID: 'next' },
  ...over,
});

const tmp = mkdtempSync(join(tmpdir(), 'policy-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('policy file', () => {
  it('missing file → defaults', () => {
    expect(loadPolicy(join(tmp, 'none.yaml'))).toEqual(DEFAULT_POLICY);
    expect(DEFAULT_POLICY).toEqual({ protectedApps: [], allowSessionApprove: true, headless: { allow: ['R0'] } });
  });

  it('parses the example file', () => {
    const p = loadPolicy(join(import.meta.dirname, '..', '..', '..', 'siavash.policy.example.yaml'));
    expect(p).toEqual({
      protectedApps: ['shop-prod'],
      maxMonthlyCostToman: 2000000,
      allowSessionApprove: true,
      headless: { allow: ['R0'] },
    });
  });

  it('rejects R2/R3 in headless.allow, bad types and invalid YAML (Persian message)', () => {
    expect(() => parsePolicy({ headless: { allow: ['R2'] } })).toThrow(ValidationError);
    expect(() => parsePolicy({ maxMonthlyCostToman: -1 })).toThrow(ValidationError);
    const f = join(tmp, 'bad.yaml');
    writeFileSync(f, 'protectedApps: [a\n');
    const e = (() => {
      try {
        loadPolicy(f);
      } catch (x) {
        return x as ValidationError;
      }
    })();
    expect(e?.messageFa).toContain('policy');
  });
});

describe('applyPolicy', () => {
  const policy = parsePolicy({ protectedApps: ['shop'], maxMonthlyCostToman: 1_000_000, headless: { allow: ['R0', 'R1'] } });

  it('protected app → at least R2 (R0 stays R0)', () => {
    expect(applyPolicy(plan(Risk.R1), policy).plan.risk).toBe(Risk.R2);
    expect(applyPolicy(plan(Risk.R3), policy).plan.risk).toBe(Risk.R3);
    expect(applyPolicy(plan(Risk.R0), policy).plan.risk).toBe(Risk.R0);
    expect(applyPolicy(plan(Risk.R1, { target: { app: 'blog' } }), policy).plan.risk).toBe(Risk.R1);
  });

  it('cost over the cap → deny with a Persian reason', () => {
    const v = applyPolicy(plan(Risk.R2, { costToman: { monthly: 1_500_000 } }), policy);
    expect(v).toMatchObject({ kind: 'deny', code: 'POLICY_COST_CAP' });
    expect(v.kind === 'deny' && v.messageFa).toContain('۱٬۵۰۰٬۰۰۰ تومان');
    expect(applyPolicy(plan(Risk.R2, { costToman: { monthly: 1_000_000 } }), policy).kind).toBe('ask');
  });

  it('headless: allow-listed risk runs, others denied', () => {
    expect(applyPolicy(plan(Risk.R1, { target: { app: 'blog' } }), policy, { headless: true }).kind).toBe('allow');
    expect(applyPolicy(plan(Risk.R1), policy, { headless: true })).toMatchObject({ kind: 'deny', code: 'POLICY_HEADLESS' });
    expect(applyPolicy(plan(Risk.R1), DEFAULT_POLICY, { headless: true }).kind).toBe('deny');
  });
});

describe('guard + policy', () => {
  const sink = () => {
    const records: GuardAuditRecord[] = [];
    return { records, audit: { record: (r: GuardAuditRecord) => records.push(r) } };
  };

  it('over the cost cap: Persian message, approver never asked, not executed, audited', async () => {
    const approver = new ScriptedApprover(['approved']);
    const { records, audit } = sink();
    let ran = false;
    const e = await guard(plan(Risk.R2, { costToman: { monthly: 3_000_000 } }), approver, async () => (ran = true), {
      policy: parsePolicy({ maxMonthlyCostToman: 2_000_000 }),
      audit,
    }).catch((x: unknown) => x as ApprovalDeniedError);
    expect(e).toBeInstanceOf(ApprovalDeniedError);
    expect((e as ApprovalDeniedError).messageFa).toContain('سقف');
    expect(ran).toBe(false);
    expect(approver.seen).toHaveLength(0);
    expect(records[0]).toMatchObject({ decision: 'denied', errorCode: 'POLICY_COST_CAP' });
  });

  it('protected app raises risk before the approver sees the plan', async () => {
    const approver = new ScriptedApprover(['approved']);
    await guard(plan(Risk.R1), approver, async () => 1, { policy: parsePolicy({ protectedApps: ['shop'] }) });
    expect(approver.seen[0]?.risk).toBe(Risk.R2);
  });

  it('allowSessionApprove: false → session approval counts once', async () => {
    const approver = new ScriptedApprover(['approved-session', 'denied']);
    const session = new SessionApprovals();
    const policy = parsePolicy({ allowSessionApprove: false });
    const r = await guard(plan(Risk.R1, { target: { app: 'blog' } }), approver, async () => 1, { policy, session });
    expect(r.status === 'executed' && r.decision).toBe('approved');
    await expect(guard(plan(Risk.R1, { target: { app: 'blog' } }), approver, async () => 2, { policy, session })).rejects.toBeInstanceOf(
      ApprovalDeniedError,
    );
    expect(approver.seen).toHaveLength(2);
  });

  it('headless: R1 runs without asking when allowed; R2 never', async () => {
    const approver = new ScriptedApprover(['approved']);
    const policy = parsePolicy({ headless: { allow: ['R0', 'R1'] } });
    const r = await guard(plan(Risk.R1, { target: { app: 'blog' } }), approver, async () => 'ok', { policy, headless: true });
    expect(r.status === 'executed' && r.decision).toBe('policy-headless');
    await expect(
      guard(plan(Risk.R2, { target: { app: 'blog' } }), approver, async () => 'no', { policy, headless: true }),
    ).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(approver.seen).toHaveLength(0);
  });

  it('edited params that exceed the cap are still denied', async () => {
    const approver = new ScriptedApprover([{ edited: { planID: 'huge' } }]);
    let ran = false;
    await expect(
      guard(plan(Risk.R2, { costToman: { monthly: 500_000 } }), approver, async () => (ran = true), {
        policy: parsePolicy({ maxMonthlyCostToman: 1_000_000 }),
        reassess: (p) => ({ ...p, costToman: { monthly: 5_000_000 } }),
      }),
    ).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(ran).toBe(false);
  });
});
