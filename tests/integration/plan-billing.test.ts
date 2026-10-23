import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Session } from '../../src/agent/session.js';
import { analyzeProject } from '../../src/analyzer/report.js';
import { planBillingStep, requiredBalance, runPipeline, type PipelineEvent, type PlanBillingDeps, type PlanBillingState } from '../../src/deploy/index.js';
import { createLiaraClient } from '../../src/liara/index.js';
import { PlanCatalog } from '../../src/planner/plans.js';
import { ScriptedApprover, YesApprover } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { ScriptedUi } from '../../src/ui/cli/scripted-ui.js';
import { project } from '../helpers/projects.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-plan-billing-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function setup(opts: { balance?: number; answers?: ConstructorParameters<typeof ScriptedUi>[0]; approver?: PlanBillingDeps['ops']['approver']; yes?: boolean } = {}) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  const mock = liara.mock!.state;
  if (opts.balance !== undefined) mock.billing.balance = opts.balance;
  const ui = new ScriptedUi(opts.answers ?? []);
  const approver = opts.approver ?? new ScriptedApprover(['approved']);
  let sleeps = 0;
  const onSleep: Array<(n: number) => void> = [];
  const deps: PlanBillingDeps = {
    liara,
    catalog: new PlanCatalog(liara.cli),
    ui,
    ops: { approver },
    ...(opts.yes ? { yes: true } : {}),
    pollMs: 1,
    pollsAfterTopUp: 1,
    maxWaitMs: 3,
    sleep: async () => {
      sleeps++;
      for (const f of onSleep) f(sleeps);
    },
  };
  const report = await analyzeProject(project('express-api'));
  const state: PlanBillingState = { report, appName: 'shop', goal: 'test', redeploy: false };
  return { liara, mock, ui, approver, deps, state, onSleep };
}

const step = (deps: PlanBillingDeps) => ({ id: 'deploy', steps: [planBillingStep<PlanBillingState>(deps)] });

describe('plan & billing step (mock Liara)', () => {
  it('enough balance: choose a plan, cost, then one R2 approval card; nothing is created', async () => {
    const w = await setup({ answers: [{ match: /پلن/, answer: 'performance' }] });
    const r = await runPipeline(step(w.deps), { state: w.state });
    expect(r.status).toBe('done');
    expect(r.state.planChoice).toMatchObject({ tier: 'performance', planId: 'medium-g2' });
    expect(r.state.cost?.items.map((i) => i.kind)).toEqual(['app', 'db', 'disk']);
    expect(r.state.cost?.complete).toBe(false);
    expect(r.state.deployApproval?.planHash).toMatch(/^[0-9a-f]{64}$/);
    const seen = (w.approver as ScriptedApprover).seen;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ risk: Risk.R2, toolName: 'approve_deploy_plan', target: { app: 'shop' } });
    expect(seen[0]?.costToman?.monthly).toBe(r.state.cost?.totalMonthlyToman);
    expect(seen[0]?.impactFa).toContain('postgres');
    // the recommended option is listed first (default)
    expect(w.ui.prompts[0]?.options?.[0]).toBe('recommended');
    expect(w.mock.apps.size).toBe(0);
    expect(w.mock.databases).toHaveLength(0);
  });

  it('acceptance: low balance → human top-up → mock balance rises → continues; nothing created before approval', async () => {
    const w = await setup({ balance: 100_000, answers: ['recommended', 'charged', 'charged'] });
    let createdBeforeApproval = false;
    w.onSleep.push((n) => {
      if (n === 2) w.mock.billing.balance = 10_000_000;
    });
    const approver = w.approver as ScriptedApprover;
    const orig = approver.request.bind(approver);
    approver.request = async (plan) => {
      createdBeforeApproval = w.mock.apps.size > 0 || w.mock.databases.length > 0;
      return orig(plan);
    };
    const events: PipelineEvent[] = [];
    const r = await runPipeline(step(w.deps), { state: w.state, onEvent: (e) => events.push(e) });
    expect(r.status).toBe('done');
    expect(r.state.balanceToman).toBe(10_000_000);
    const card = w.ui.notes.find((n) => n.body.includes('console.liara.ir'));
    expect(card?.body).toContain('شارژ');
    expect(w.ui.notes.some((n) => n.body.includes('هنوز'))).toBe(true);
    const statuses = events.filter((e) => e.type === 'step').map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(expect.arrayContaining(['waiting-human', 'waiting-approval']));
    expect(createdBeforeApproval).toBe(false);
    expect(r.state.deployApproval).toBeDefined();
  });

  it('low balance + cancel → waiting-human (no approval asked); resume after top-up keeps the plan choice', async () => {
    const dir = join(root, 'sess');
    const session = Session.create(dir);
    const w = await setup({ balance: 100_000, answers: ['economy', 'cancel'] });
    const r = await runPipeline(step(w.deps), { state: w.state, session });
    expect(r).toMatchObject({ status: 'waiting-human', failedStep: 'plan-billing' });
    expect(r.messageFa).toContain('--resume');
    expect((w.approver as ScriptedApprover).seen).toHaveLength(0);

    w.mock.billing.balance = 10_000_000;
    const resumed = await runPipeline(step(w.deps), { state: { report: w.state.report }, session, resume: true });
    expect(resumed.status).toBe('done');
    expect(resumed.state.planChoice?.tier).toBe('economy');
    expect(w.ui.remaining).toBe(0);
  });

  it('approval denied → failed, no approval recorded', async () => {
    const w = await setup({ answers: ['recommended'], approver: new ScriptedApprover(['denied']) });
    const r = await runPipeline(step(w.deps), { state: w.state });
    expect(r.status).toBe('failed');
    expect(r.state.deployApproval).toBeUndefined();
  });

  it('--yes: recommended without a prompt; polls then pauses on low balance; never approves R2 by itself', async () => {
    const low = await setup({ balance: 100_000, yes: true, approver: new YesApprover() });
    const r = await runPipeline(step(low.deps), { state: low.state });
    expect(r.status).toBe('waiting-human');
    expect(low.ui.prompts).toEqual([]);

    const ok = await setup({ yes: true, approver: new YesApprover() });
    const r2 = await runPipeline(step(ok.deps), { state: ok.state });
    expect(r2.state.planChoice?.tier).toBe('recommended');
    expect(r2.status).toBe('failed');
    expect(r2.state.deployApproval).toBeUndefined();
  });

  it('redeploy → step skipped', async () => {
    const w = await setup();
    const r = await runPipeline(step(w.deps), { state: { ...w.state, redeploy: true } });
    expect(r.steps['plan-billing']).toBe('skipped');
  });

  it('requiredBalance: monthly × 1.2, at least the Liara minimum credit', () => {
    expect(requiredBalance(1_000_000)).toBe(1_200_000);
    expect(requiredBalance(10_000, 50_000)).toBe(50_000);
  });
});
