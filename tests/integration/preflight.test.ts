import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { afterAll, describe, expect, it } from 'vitest';
import { preflightStep, runPipeline, runPreflight, type PreflightDeps, type PreflightState } from '../../src/deploy/index.js';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { LiaraApiError } from '../../src/shared/errors.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-preflight-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const mockLiara = () => createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });

function projectDir(files: Record<string, string> = { 'package.json': '{"name":"shop"}' }): string {
  const dir = mkdtempSync(join(root, 'p-'));
  for (const [rel, c] of Object.entries(files)) writeFileSync(join(dir, rel), c);
  return dir;
}

function deps(over: Partial<PreflightDeps> & { projectPath: string }): PreflightDeps {
  return { liara: mockLiara(), config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'cli' }, ...over };
}

const byId = (r: Awaited<ReturnType<typeof runPreflight>>) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

describe('preflight (mock Liara)', () => {
  it('happy path: token, CLI and project ok; missing .liaraignore and no git → warnings/info only', async () => {
    const r = await runPreflight(deps({ projectPath: projectDir() }));
    expect(r.ok).toBe(true);
    const c = byId(r);
    expect(c.token?.severity).toBe('ok');
    expect(c.cli?.severity).toBe('ok');
    expect(c.project?.severity).toBe('ok');
    expect(c.team?.severity).toBe('info');
    expect(c.git).toMatchObject({ severity: 'info' });
    expect(c.liaraignore).toMatchObject({ severity: 'warning' });
    expect(c.liaraignore?.fixFa).toContain('.liaraignore');
  });

  it('git with uncommitted changes → warning; .liaraignore present → ok', async () => {
    const dir = projectDir({ 'package.json': '{"name":"shop"}', '.liaraignore': 'node_modules\n.env\n' });
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@example.com').addConfig('user.name', 'test');
    await git.add('.').commit('init');
    writeFileSync(join(dir, 'index.js'), 'console.log(1)\n');
    const c = byId(await runPreflight(deps({ projectPath: dir })));
    expect(c.git).toMatchObject({ severity: 'warning' });
    expect(c.git?.whatFa).toContain('1');
    expect(c.liaraignore?.severity).toBe('ok');
  });

  it('team from LIARA_TEAM_ID is reported', async () => {
    const c = byId(await runPreflight(deps({ projectPath: projectDir(), config: { liara: { token: undefined, teamId: 'team-7', mode: 'mock' }, deployMode: 'cli' } })));
    expect(c.team?.whatFa).toContain('team-7');
  });

  it('acceptance: every blocker says what happened and what to do (Persian)', async () => {
    const badToken: Pick<LiaraClient, 'account' | 'cli'> = {
      ...mockLiara(),
      account: { getMe: async () => ({ tokenValid: false, appCount: undefined }) } as LiaraClient['account'],
    };
    const r = await runPreflight(deps({ liara: badToken, projectPath: join(root, 'does-not-exist') }));
    expect(r.ok).toBe(false);
    const blockers = r.checks.filter((c) => c.severity === 'blocker');
    expect(blockers.map((b) => b.id).sort()).toEqual(['project', 'token']);
    for (const b of blockers) {
      expect(b.whatFa).toMatch(/[؀-ۿ]/);
      expect(b.fixFa).toMatch(/[؀-ۿ]/);
    }
  });

  it('live mode without a token → blocker without calling Liara', async () => {
    let called = false;
    const liara = { ...mockLiara(), account: { getMe: async () => ((called = true), { tokenValid: true, appCount: 0 }) } as LiaraClient['account'] };
    const r = await runPreflight(deps({ liara, projectPath: projectDir(), config: { liara: { token: undefined, teamId: undefined, mode: 'live' }, deployMode: 'cli' } }));
    expect(byId(r).token?.severity).toBe('blocker');
    expect(called).toBe(false);
  });

  it('network error while checking the token → blocker with the Persian cause', async () => {
    const liara = {
      ...mockLiara(),
      account: { getMe: async () => Promise.reject(new LiaraApiError('down', { status: 503, messageFa: 'سرور لیارا در دسترس نیست' })) } as LiaraClient['account'],
    };
    const c = byId(await runPreflight(deps({ liara, projectPath: projectDir() })));
    expect(c.token?.whatFa).toContain('سرور لیارا در دسترس نیست');
  });

  it('CLI missing → blocker; skipped when not needed and DEPLOY_MODE=api', async () => {
    const noCli = { ...mockLiara(), cli: { ensureCli: async () => ({ available: false, viaNpx: false, version: undefined, hintFa: 'x' }) } as unknown as LiaraClient['cli'] };
    expect(byId(await runPreflight(deps({ liara: noCli, projectPath: projectDir() }))).cli?.severity).toBe('blocker');
    const r = await runPreflight(deps({ liara: noCli, projectPath: projectDir(), needCli: false, config: { liara: { token: undefined, teamId: undefined, mode: 'mock' }, deployMode: 'api' } }));
    expect(byId(r).cli).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('as a pipeline step: blockers fail the step with the Persian what/fix message', async () => {
    const step = preflightStep<PreflightState>(deps({ projectPath: join(root, 'nope') }));
    const r = await runPipeline({ id: 'deploy', steps: [step] }, { state: {} });
    expect(r).toMatchObject({ status: 'failed', failedStep: 'preflight' });
    expect(r.messageFa).toContain('چه کار کنید');
    expect(r.state.preflight?.ok).toBe(false);

    mkdirSync(join(root, 'ok-proj'));
    const ok = await runPipeline({ id: 'deploy', steps: [preflightStep<PreflightState>(deps({ projectPath: join(root, 'ok-proj') }))] }, { state: {} });
    expect(ok.status).toBe('done');
  });
});
