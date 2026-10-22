import { describe, expect, it } from 'vitest';
import { escalate, isSecretEnvName, maxRisk, Risk, riskLabel, type ActionPlan } from '../../../src/safety/risk.js';

const plan = (over: Partial<ActionPlan>): ActionPlan => ({
  id: 'p1',
  toolName: 'restart_app',
  titleFa: 't',
  reasonFa: 'r',
  target: { app: 'shop' },
  risk: Risk.R1,
  impactFa: 'i',
  rollbackFa: 'b',
  command: 'POST /v1/projects/shop/actions/restart',
  params: {},
  ...over,
});

describe('Risk basics', () => {
  it('ordering and labels', () => {
    expect(Risk.R0 < Risk.R1 && Risk.R1 < Risk.R2 && Risk.R2 < Risk.R3).toBe(true);
    expect(riskLabel(Risk.R2)).toBe('R2');
    expect(maxRisk(Risk.R1, Risk.R3)).toBe(Risk.R3);
  });
});

describe('escalate', () => {
  const ctx = { productionApps: ['shop'], protectedApps: ['billing-api'] };

  it('stop on a production app → R3', () => {
    const p = escalate(plan({ toolName: 'stop_app', risk: Risk.R1 }), ctx);
    expect(p.risk).toBe(Risk.R3);
    expect(p.escalations).toEqual(['STOP_PROTECTED_APP']);
  });

  it('scale=0 on a protected app → R3; scale=1 stays', () => {
    expect(escalate(plan({ toolName: 'scale_app', target: { app: 'billing-api' }, params: { scale: 0 } }), ctx).risk).toBe(
      Risk.R3,
    );
    expect(escalate(plan({ toolName: 'scale_app', target: { app: 'billing-api' }, params: { scale: 1 } }), ctx).risk).toBe(
      Risk.R1,
    );
  });

  it('stop on a non-production, non-protected app is not escalated', () => {
    expect(escalate(plan({ toolName: 'stop_app', target: { app: 'sandbox' } }), ctx).risk).toBe(Risk.R1);
  });

  it.each(['STRIPE_API_KEY', 'JWT_SECRET', 'DB_PASSWORD', 'password', 'GITHUB_TOKEN', 'DATABASE_URL', 'MONGO_URI'])(
    'secret-like env %s → at least R2',
    (key) => {
      const p = escalate(plan({ toolName: 'set_env', params: { vars: { [key]: 'x' } } }));
      expect(p.risk).toBe(Risk.R2);
      expect(p.escalations).toContain('SECRET_ENV');
    },
  );

  it('non-secret env stays R1; existing higher risk is never lowered', () => {
    expect(escalate(plan({ toolName: 'set_env', params: { vars: { APP_NAME: 'x', PORT: '3000' } } })).risk).toBe(Risk.R1);
    expect(escalate(plan({ toolName: 'set_env', risk: Risk.R3, params: { vars: { API_KEY: 'x' } } })).risk).toBe(Risk.R3);
  });

  it('env change under replace semantics that removes vars → R3', () => {
    const set = plan({ toolName: 'set_env', params: { vars: { A: '1' }, removedCount: 2 } });
    expect(escalate(set, { envSemantics: 'replace' }).risk).toBe(Risk.R3);
    expect(escalate(set, { envSemantics: 'merge' }).risk).toBe(Risk.R1);
    const unset = plan({ toolName: 'unset_env', params: { keys: ['A'] } });
    expect(escalate(unset, { envSemantics: 'replace' }).escalations).toContain('ENV_REPLACE_REMOVES_VARS');
    expect(escalate(plan({ toolName: 'set_env', params: { vars: { A: '1' }, removedCount: 0 } }), { envSemantics: 'replace' }).risk).toBe(
      Risk.R1,
    );
  });

  it('fixed-ip enable → R2; disable not escalated', () => {
    expect(escalate(plan({ toolName: 'set_fixed_ip', params: { on: true } })).risk).toBe(Risk.R2);
    expect(escalate(plan({ toolName: 'set_fixed_ip', params: { status: 'enable' } })).escalations).toEqual(['FIXED_IP_COST']);
    expect(escalate(plan({ toolName: 'set_fixed_ip', params: { on: false } })).risk).toBe(Risk.R1);
  });

  it('isSecretEnvName', () => {
    expect(isSecretEnvName('APP_NAME')).toBe(false);
    expect(isSecretEnvName('PORT')).toBe(false);
    expect(isSecretEnvName('REDIS_URI')).toBe(true);
  });
});
