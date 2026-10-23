import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../src/analyzer/report.js';
import { deployStep, runPipeline, type DeployStepDeps, type DeployStepState, type PipelineEvent } from '../../src/deploy/index.js';
import { createLiaraClient } from '../../src/liara/index.js';
import { ScriptedApprover, type ApprovalDecision, type GuardAuditRecord } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { ScriptedUi } from '../../src/ui/cli/scripted-ui.js';
import { project } from '../helpers/projects.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-deploy-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function setup(opts: { mode: 'api' | 'cli'; fails?: boolean; redeploy?: boolean; decisions?: ApprovalDecision[]; deps?: Partial<DeployStepDeps> }) {
  const dir = join(mkdtempSync(join(root, 'p-')), 'shop');
  cpSync(project('express-api'), dir, { recursive: true });
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  const mock = liara.mock!.state;
  mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  if (opts.fails) mock.nextDeployFails = true;
  const ui = new ScriptedUi([]);
  const approver = new ScriptedApprover(opts.decisions ?? ['approved']);
  const audit: GuardAuditRecord[] = [];
  const lines: string[] = [];
  const deps: DeployStepDeps = {
    liara,
    ui,
    ops: { approver, audit: { record: (r) => audit.push(r) } },
    mode: opts.mode,
    onLine: (l) => lines.push(l),
    wait: { intervalMs: 2, timeoutMs: 3_000, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) },
    ...opts.deps,
  };
  const state: DeployStepState = {
    projectPath: dir,
    report: await analyzeProject(dir),
    appName: 'shop',
    redeploy: !!opts.redeploy,
    ...(opts.redeploy
      ? {}
      : {
          planChoice: { tier: 'recommended' as const, planId: 'small-g2', monthlyToman: 1, ramMb: 512, cpu: 0.5 },
          deployApproval: { planHash: 'h'.repeat(64), approvedAt: '2026-10-23T00:00:00.000Z' },
        }),
  };
  const events: PipelineEvent[] = [];
  const run = () => runPipeline({ id: 'deploy', steps: [deployStep<DeployStepState>(deps)] }, { state, onEvent: (e) => events.push(e) });
  const notes = () => events.filter((e) => e.type === 'step').map((e) => (e as { noteFa?: string }).noteFa).filter(Boolean) as string[];
  return { liara, mock, ui, approver, audit, lines, deps, state, run, notes };
}

describe('deploy step — CLI mode (mock)', () => {
  it('success: stages shown (not raw lines), version recorded, ledger before/after, pre-approved by the plan card', async () => {
    const w = await setup({ mode: 'cli' });
    const r = await w.run();
    expect(`${r.status} ${r.messageFa ?? ''}`).toBe('done ');
    expect(r.state.deployment).toMatchObject({ mode: 'cli', result: 'success', version: 'v1' });
    expect(w.notes()).toEqual(expect.arrayContaining(['آپلود کد', 'ساخت (build)', 'deploy موفق بود (نسخهٔ v1).']));
    expect(w.lines).toEqual([]);
    const rec = w.liara.ledger.latest('shop');
    expect(rec).toMatchObject({ mode: 'cli', result: 'success', version: 'v1', port: 3000, platform: 'node', gitDirty: false });
    expect(rec?.finishedAt).toBeDefined();
    expect(w.approver.seen).toEqual([]);
    expect(w.audit.map((a) => [a.plan.toolName, a.result])).toEqual([['deploy_app', 'ok']]);
  });

  it('--verbose prints the raw CLI lines', async () => {
    const w = await setup({ mode: 'cli', deps: { verbose: true } });
    await w.run();
    expect(w.lines.some((l) => l.includes('Building'))).toBe(true);
  });

  it('failure: last log lines + short Persian message; ledger failed; audit records the error', async () => {
    const w = await setup({ mode: 'cli', fails: true });
    const r = await w.run();
    expect(r).toMatchObject({ status: 'failed', failedStep: 'deploy', messageFa: 'deploy شکست خورد.' });
    expect(w.ui.notes.find((n) => n.title === 'آخرین خطوط لاگ')?.body).toContain('Build failed');
    expect(w.liara.ledger.latest('shop')?.result).toBe('failed');
    expect(w.audit.map((a) => [a.plan.toolName, a.result])).toEqual([['deploy_app', 'error']]);
    expect(r.state.deployment?.result).toBe('failed');
  });
});

describe('deploy step — API mode (mock)', () => {
  it('success: archive → upload with percent → release → events signal; ids and sha in the ledger', async () => {
    const w = await setup({ mode: 'api' });
    const r = await w.run();
    expect(`${r.status} ${r.messageFa ?? ''}`).toBe('done ');
    expect(r.state.deployment).toMatchObject({ mode: 'api', result: 'success' });
    expect(r.state.deployment?.releaseID).toBeTruthy();
    expect(w.notes()).toEqual(expect.arrayContaining(['فشرده‌سازی کد پروژه…', 'آپلود: 100٪', 'منتظر آماده شدن نسخهٔ جدید…']));
    const rec = w.liara.ledger.latest('shop');
    expect(rec?.result).toBe('success');
    expect(rec?.sourceID).toBeTruthy();
    expect(rec?.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(w.mock.apps.get('shop')?.isDeployed).toBe(true);
  });

  it('failure: the build-failed event decides; log tail shown', async () => {
    const w = await setup({ mode: 'api', fails: true });
    const r = await w.run();
    expect(r).toMatchObject({ status: 'failed', messageFa: 'deploy شکست خورد.' });
    expect(w.ui.notes.find((n) => n.title === 'آخرین خطوط لاگ')?.body).toContain('Build failed');
    expect(w.liara.ledger.latest('shop')?.result).toBe('failed');
  });

  it('no signal decides → timeout (never reported as success)', async () => {
    const w = await setup({ mode: 'api', deps: { signals: [{ name: 'never', check: async () => ({ verdict: 'pending' }) }], wait: { intervalMs: 1, timeoutMs: 20, sleep: async () => {} } } });
    const r = await w.run();
    expect(r.status).toBe('failed');
    expect(r.messageFa).toContain('زمان مقرر');
    expect(w.liara.ledger.latest('shop')?.result).toBe('timeout');
  });

  it('platform id not confirmed → API mode refuses (OQ-20)', async () => {
    const w = await setup({ mode: 'api' });
    w.state.report!.platform.liaraPlatformId = undefined;
    const r = await w.run();
    expect(r.status).toBe('failed');
    expect(w.liara.ledger.latest('shop')).toBeUndefined();
  });
});

describe('deploy step — redeploy', () => {
  it('asks its own R1 approval; denied → nothing deployed, nothing in the ledger', async () => {
    const w = await setup({ mode: 'cli', redeploy: true, decisions: ['denied'] });
    const r = await w.run();
    expect(r.status).toBe('failed');
    expect(w.approver.seen.map((p) => [p.toolName, p.risk])).toEqual([['deploy_app', Risk.R1]]);
    expect(w.liara.ledger.latest('shop')).toBeUndefined();
    expect(w.mock.apps.get('shop')?.releases).toHaveLength(0);
  });
});
