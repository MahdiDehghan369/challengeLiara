import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../src/analyzer/report.js';
import { provisionStep, runPipeline, SecretStore, type ProvisionDeps, type ProvisionState } from '../../src/deploy/index.js';
import { createLiaraClient } from '../../src/liara/index.js';
import { ScriptedApprover, type ApprovalDecision } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { Secret } from '../../src/shared/secret.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';
import { project } from '../helpers/projects.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-provision-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const MANUAL_DB: ScriptedAnswer[] = [
  { match: /host/, answer: 'shop-db.internal' },
  { match: /پورت/, answer: '5432' },
  { match: /کاربری/, answer: 'root' },
  { match: /رمز/, answer: 'p@ss-w0rd-123' },
  { match: /نام دیتابیس/, answer: 'shop' },
];

async function setup(opts: { answers?: ScriptedAnswer[]; decisions?: ApprovalDecision[]; fixture?: string; approved?: boolean; deps?: Partial<ProvisionDeps> } = {}) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  const mock = liara.mock!.state;
  let createAppCalls = 0;
  const orig = liara.apps.createApp.bind(liara.apps);
  liara.apps.createApp = async (input) => {
    createAppCalls++;
    return orig(input);
  };
  const ui = new ScriptedUi(opts.answers ?? MANUAL_DB);
  const approver = new ScriptedApprover(opts.decisions ?? ['approved']);
  const secrets = new SecretStore();
  const deps: ProvisionDeps = {
    liara,
    ui,
    ops: { approver },
    secrets,
    dbPlan: 'db-small',
    // a real (tiny) sleep: the mock applies async actions on timers, which a no-op sleep would starve
    wait: { intervalMs: 1, timeoutMs: 2_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    dbPollAttempts: 2,
    ...opts.deps,
  };
  const report = await analyzeProject(project(opts.fixture ?? 'express-api'));
  const state: ProvisionState = {
    report,
    appName: 'shop',
    redeploy: false,
    planChoice: { tier: 'recommended', planId: 'small-g2', monthlyToman: 474998.4, ramMb: 512, cpu: 0.5 },
    ...(opts.approved === false ? {} : { deployApproval: { planHash: 'x'.repeat(64), approvedAt: '2026-10-23T00:00:00.000Z' } }),
  };
  return { liara, mock, ui, approver, secrets, deps, state, calls: () => createAppCalls };
}

const pipe = (deps: ProvisionDeps) => ({ id: 'deploy', steps: [provisionStep<ProvisionState>(deps)] });

describe('provision step (mock Liara)', () => {
  it('creates app (pre-approved), database (own R2 approval, manual hidden input) and disk', async () => {
    const w = await setup();
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('done');
    expect(w.mock.apps.get('shop')?.planID).toBe('small-g2');
    expect(w.mock.databases).toEqual([expect.objectContaining({ name: 'shop-db', type: 'postgres', plan: 'db-small' })]);
    expect(w.mock.apps.get('shop')?.disks.map((d) => d.name)).toEqual(['data']);
    expect(r.state.provisioned).toEqual({
      app: { name: 'shop', planId: 'small-g2' },
      db: { name: 'shop-db', type: 'postgres', envName: 'DATABASE_URL', connection: 'manual' },
      disk: { name: 'data', sizeGb: 1, folders: ['uploads'] },
    });
    // only the database needed a new approval; app and disk were on the deploy-plan card
    expect(w.approver.seen.map((p) => [p.toolName, p.risk])).toEqual([['create_database', Risk.R2]]);
    // the connection string is a Secret in memory only; the password was hidden input
    expect(w.secrets.get('DATABASE_URL')?.reveal()).toBe('postgresql://root:p%40ss-w0rd-123@shop-db.internal:5432/shop');
    expect(w.ui.prompts.find((p) => p.kind === 'password')?.answer).toBe('••••');
    expect(JSON.stringify(r.state)).not.toContain('p@ss-w0rd-123');
  });

  it('idempotent: a second run (resume) creates nothing again', async () => {
    const w = await setup({ answers: [...MANUAL_DB] });
    const first = await runPipeline(pipe(w.deps), { state: w.state });
    expect(first.status).toBe('done');
    const again = await runPipeline(pipe(w.deps), { state: first.state });
    expect(`${again.status} ${again.messageFa ?? ''}`).toBe('done ');
    expect(w.calls()).toBe(1);
    expect(w.mock.databases).toHaveLength(1);
    expect(w.mock.apps.get('shop')?.disks).toHaveLength(1);
    expect(w.approver.seen).toHaveLength(1);
  });

  it('nothing is created without the deploy-plan approval', async () => {
    const w = await setup({ approved: false });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('failed');
    expect(r.messageFa).toContain('تأیید');
    expect(w.mock.apps.size).toBe(0);
    expect(w.calls()).toBe(0);
  });

  it('acceptance: a database failure does not delete the app; keeping it is the default choice', async () => {
    const w = await setup({ answers: [{ match: /با اپ چه کنیم/, answer: 'keep' }], decisions: ['denied'] });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r).toMatchObject({ status: 'failed', failedStep: 'provision' });
    expect(w.mock.apps.has('shop')).toBe(true);
    expect(w.ui.notes.some((n) => n.body.includes('اپ ساخته‌شده حذف نشد'))).toBe(true);
    expect(w.ui.prompts[0]?.options).toEqual(['keep', 'delete']);
  });

  it('acceptance: cleanup is offered as an R3 delete through the gate', async () => {
    const w = await setup({ answers: [{ match: /با اپ چه کنیم/, answer: 'delete' }], decisions: ['denied', 'approved'] });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('failed');
    expect(w.approver.seen.map((p) => [p.toolName, p.risk])).toEqual([
      ['create_database', Risk.R2],
      ['delete_app', Risk.R3],
    ]);
    expect(w.mock.apps.has('shop')).toBe(false);
    expect(r.state.provisioned?.app).toBeUndefined();
  });

  it('connection details from Liara → stored automatically, no prompts', async () => {
    const w = await setup({ answers: [] });
    w.liara.db.getDbConnection = async () => ({
      status: 'ok',
      type: 'postgres',
      internal: { host: 'shop-db', port: 5432 },
      public: undefined,
      username: 'root',
      password: new Secret('auto-pass-xyz'),
      database: 'shop',
      connectionString: new Secret('postgresql://root:auto-pass-xyz@shop-db:5432/shop'),
    });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('done');
    expect(r.state.provisioned?.db?.connection).toBe('auto');
    expect(w.secrets.get('DATABASE_URL')?.reveal()).toContain('auto-pass-xyz');
    expect(w.ui.prompts).toEqual([]);
  });

  it('--yes without a db plan → clear Persian error (no guess); the app stays', async () => {
    const w = await setup({ answers: [], deps: { yes: true, dbPlan: undefined } });
    delete (w.deps as { dbPlan?: string }).dbPlan;
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('failed');
    expect(r.messageFa).toContain('پلن دیتابیس');
    expect(w.mock.apps.has('shop')).toBe(true);
    expect(w.mock.databases).toHaveLength(0);
  });

  it('platform without a confirmed Liara id → stops before creating anything (OQ-20)', async () => {
    const w = await setup({ fixture: 'django-app', answers: [] });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('failed');
    expect(w.mock.apps.size).toBe(0);
  });

  it('redeploy → skipped', async () => {
    const w = await setup({ answers: [] });
    const r = await runPipeline(pipe(w.deps), { state: { ...w.state, redeploy: true } });
    expect(r.steps.provision).toBe('skipped');
  });
});
