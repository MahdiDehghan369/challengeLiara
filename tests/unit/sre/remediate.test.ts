import { describe, expect, it } from 'vitest';
import { parsePlanList } from '../../../src/planner/plans.js';
import { Risk } from '../../../src/safety/risk.js';
import type { Hypothesis } from '../../../src/sre/rca.js';
import { planRemediation } from '../../../src/sre/remediate.js';
import { loadRecorded } from '../../helpers/fixtures.js';

const plans = parsePlanList(loadRecorded('cli.plan-list.json'));
const small = plans.find((p) => p.id === 'small-g2')!;

function hyp(id: string, confidence: number, fixes: Hypothesis['proposedFixes'], over: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id,
    titleFa: 'عنوان',
    category: 'code',
    confidence,
    evidence: [{ type: 'log', ref: 'log:1', quote: 'x' }],
    explanationFa: 'توضیح ساده برای کاربر',
    proposedFixes: fixes,
    howToVerifyFa: 'health check را اجرا کنید',
    source: 'rules',
    ...over,
  };
}
const fix = (actionType: Hypothesis['proposedFixes'][number]['actionType'], params?: Record<string, string | number | boolean>) => ({
  actionType,
  expectedEffectFa: 'اثر',
  ...(params ? { params } : {}),
});

describe('planRemediation', () => {
  it('http-500 style: quick = rollback (R2), root = code patch; options least risky first', () => {
    const r = planRemediation({ hypotheses: [hyp('h1', 0.6, [fix('code_patch'), fix('rollback_app')]), hyp('h2', 0.3, [fix('restart_app')], { category: 'platform' })] }, { app: 'shop', hasHealthyPrevious: true });
    expect(r.quickFix).toMatchObject({ tool: 'rollback_app', kind: 'quick', args: { app: 'shop', to: 'last-healthy' } });
    expect(r.rootFix).toMatchObject({ tool: 'code_patch', kind: 'root', risk: Risk.R2 });
    expect(r.options.map((o) => o.risk)).toEqual([...r.options.map((o) => o.risk)].sort((a, b) => a - b));
    expect(r.options[0]?.tool).toBe('restart_app');
  });

  it('oom: resize targets the next plan with more RAM; set_env of a secret name is shown as R2', () => {
    const r = planRemediation(
      { hypotheses: [hyp('h1', 0.75, [fix('resize_app', { direction: 'up' }), fix('set_env', { name: 'NODE_OPTIONS' })], { category: 'resource' })] },
      { app: 'shop', currentPlan: small, plans },
    );
    expect(r.quickFix).toMatchObject({ tool: 'resize_app', args: { planID: 'medium-g2' }, needsInput: [] });
    expect(r.rootFix).toMatchObject({ tool: 'set_env', args: { name: 'NODE_OPTIONS' }, needsInput: ['value'], risk: Risk.R1 });
    const secret = planRemediation({ hypotheses: [hyp('h1', 0.8, [fix('set_env', { name: 'DATABASE_URL' })], { category: 'config' })] }, { app: 'shop' });
    expect(secret.rootFix).toMatchObject({ tool: 'set_env', risk: Risk.R2 });
  });

  it('missing-env: root = set_env; no quick fix on the hypothesis → generic quick fix (restart without a healthy previous)', () => {
    const r = planRemediation({ hypotheses: [hyp('h1', 0.8, [fix('set_env', { name: 'JWT_SECRET' })], { category: 'config' })] }, { app: 'shop', hasHealthyPrevious: false });
    expect(r.rootFix?.tool).toBe('set_env');
    expect(r.quickFix?.tool).toBe('restart_app');
  });

  it('acceptance: manual produces Persian step-by-step instructions', () => {
    const r = planRemediation({ hypotheses: [hyp('h1', 0.6, [fix('manual')], { category: 'network', explanationFa: 'گواهی SSL دامنه هنوز صادر نشده است.' })] }, { app: 'shop' });
    expect(r.rootFix?.tool).toBe('manual');
    const steps = r.rootFix?.manualStepsFa ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps.join('\n')).toContain('گواهی SSL دامنه هنوز صادر نشده است.');
    for (const s of steps) expect(s).toMatch(/[؀-ۿ]/);
    expect(r.rootFix?.risk).toBe(Risk.R0);
  });

  it('rollback is skipped when no healthy previous version exists; resize without a catalog needs a plan', () => {
    const r = planRemediation({ hypotheses: [hyp('h1', 0.7, [fix('rollback_app'), fix('code_patch')]), hyp('h2', 0.5, [fix('resize_app')], { category: 'resource' })] }, { app: 'shop', hasHealthyPrevious: false });
    expect(r.options.some((o) => o.tool === 'rollback_app')).toBe(false);
    expect(r.quickFix).toMatchObject({ tool: 'resize_app', needsInput: ['planID'] });
    expect(r.rootFix?.tool).toBe('code_patch');
  });

  it('config_file and run_in_container map to existing tools', () => {
    const r = planRemediation({ hypotheses: [hyp('h1', 0.6, [fix('config_file'), fix('run_in_container')], { category: 'config' })] }, { app: 'shop' });
    expect(r.options.map((o) => o.tool).sort()).toEqual(['code_patch', 'restart_app', 'run_migration']);
  });

  it('no hypotheses → no options', () => {
    expect(planRemediation({ hypotheses: [] }, { app: 'shop' })).toEqual({ quickFix: undefined, rootFix: undefined, options: [] });
  });
});
