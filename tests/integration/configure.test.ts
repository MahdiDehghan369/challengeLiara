import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { analyzeProject } from '../../src/analyzer/report.js';
import { configureStep, runPipeline, SecretStore, type ConfigureDeps, type ConfigureState } from '../../src/deploy/index.js';
import { createLiaraClient } from '../../src/liara/index.js';
import { ScriptedApprover, type GuardAuditRecord } from '../../src/safety/approval.js';
import { Risk } from '../../src/safety/risk.js';
import { Secret } from '../../src/shared/secret.js';
import type { Prompter } from '../../src/ui/cli/approver.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';
import { project } from '../helpers/projects.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-configure-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const JWT = 'jwt-very-secret-value-123';
const DB_URL = 'postgresql://root:db-pass-456@shop-db:5432/shop';

async function setup(opts: { answers?: ScriptedAnswer[]; ui?: Prompter; files?: Record<string, string>; deps?: Partial<ConfigureDeps>; goal?: 'test' | 'production'; disk?: boolean } = {}) {
  const dir = join(mkdtempSync(join(root, 'p-')), 'shop');
  cpSync(project('express-api'), dir, { recursive: true });
  for (const [rel, c] of Object.entries(opts.files ?? {})) writeFileSync(join(dir, rel), c);
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  const mock = liara.mock!.state;
  mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  const audit: GuardAuditRecord[] = [];
  const approver = new ScriptedApprover(['approved']);
  const secrets = new SecretStore();
  secrets.set('DATABASE_URL', new Secret(DB_URL));
  const ui = opts.ui ?? new ScriptedUi(opts.answers ?? []);
  const deps: ConfigureDeps = { liara, ui, ops: { approver, audit: { record: (r) => audit.push(r) } }, secrets, ...opts.deps };
  const state: ConfigureState = {
    projectPath: dir,
    report: await analyzeProject(dir),
    appName: 'shop',
    goal: opts.goal ?? 'test',
    redeploy: false,
    provisioned: {
      app: { name: 'shop', planId: 'small-g2' },
      db: { name: 'shop-db', type: 'postgres', envName: 'DATABASE_URL', connection: 'manual' },
      ...(opts.disk === false ? {} : { disk: { name: 'data', sizeGb: 1, folders: ['uploads'] } }),
    },
  };
  return { dir, liara, mock, ui, approver, audit, deps, state };
}

const pipe = (deps: ConfigureDeps) => ({ id: 'deploy', steps: [configureStep<ConfigureState>(deps)] });

describe('configure step (mock Liara)', () => {
  it('collects env (secret hidden), applies one batch, writes liara.json after a diff, creates .liaraignore, zero-downtime for production', async () => {
    const w = await setup({
      goal: 'production',
      answers: [
        { match: /JWT_SECRET/, answer: JWT },
        { match: /APP_NAME/, answer: '' },
        { match: /FEATURE_FLAG/, answer: '' },
        { match: /liara\.json/, answer: 'write' },
      ],
    });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(`${r.status} ${r.messageFa ?? ''}`).toBe('done ');

    const envs = w.mock.apps.get('shop')!.envs;
    expect(Object.fromEntries(envs)).toEqual({ DATABASE_URL: DB_URL, JWT_SECRET: JWT, APP_NAME: 'shop', PORT: '3000' });
    expect(r.state.configured).toEqual({
      envKeys: ['APP_NAME', 'DATABASE_URL', 'JWT_SECRET', 'PORT'],
      skippedEnv: ['FEATURE_FLAG'],
      liaraJson: 'written',
      liaraignore: 'created',
      diskMount: 'pending',
      zeroDowntime: true,
    });

    // one batch: a single set_env card, escalated to R2 for the secret names; then the R1 zero-downtime card
    expect(w.approver.seen.map((p) => [p.toolName, p.risk])).toEqual([
      ['set_env', Risk.R2],
      ['set_zero_downtime', Risk.R1],
    ]);
    expect(w.mock.apps.get('shop')!.settings.zeroDowntime).toBe(true);

    // liara.json + diff shown first
    expect(JSON.parse(readFileSync(join(w.dir, 'liara.json'), 'utf8'))).toEqual({ app: 'shop', port: 3000, platform: 'node' });
    const diffNote = (w.ui as ScriptedUi).notes.find((n) => n.title.includes('liara.json'));
    expect(diffNote?.body).toContain('+  "app": "shop"');
    expect(readFileSync(join(w.dir, '.liaraignore'), 'utf8')).toContain('node_modules');
  });

  it('acceptance: secret values never appear in the terminal, the approval cards or the audit log', async () => {
    const w = await setup({ answers: [JWT, '', '', 'write'] });
    await runPipeline(pipe(w.deps), { state: w.state });
    const ui = w.ui as ScriptedUi;
    const shown = JSON.stringify([ui.notes, ui.prompts, w.approver.seen, w.audit]);
    for (const secret of [JWT, 'db-pass-456']) expect(shown).not.toContain(secret);
    expect(ui.prompts.find((p) => p.kind === 'password')?.answer).toBe('••••');
    expect(w.audit.map((a) => a.plan.toolName)).toContain('set_env');
  });

  it('existing liara.json: other keys are kept; "skip" leaves the file untouched', async () => {
    const original = '{\n  "account": "me",\n  "port": 8080\n}\n';
    const w = await setup({ files: { 'liara.json': original }, answers: [JWT, '', '', 'skip'] });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.state.configured?.liaraJson).toBe('skipped');
    expect(readFileSync(join(w.dir, 'liara.json'), 'utf8')).toBe(original);
    const diffNote = (w.ui as ScriptedUi).notes.find((n) => n.title.includes('liara.json'));
    expect(diffNote?.body).toContain('-  "port": 8080');
    expect(diffNote?.body).toContain('"account": "me"');
  });

  it('invalid liara.json is never overwritten', async () => {
    const w = await setup({ files: { 'liara.json': '{ broken' }, answers: [JWT, '', ''] });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.state.configured?.liaraJson).toBe('invalid');
    expect(readFileSync(join(w.dir, 'liara.json'), 'utf8')).toBe('{ broken');
  });

  it('--yes: optional vars skipped, liara.json written without asking; required secrets still asked (hidden)', async () => {
    const w = await setup({ answers: [{ match: /JWT_SECRET/, answer: JWT }], deps: { yes: true }, files: { '.liaraignore': 'node_modules\n' } });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.status).toBe('done');
    expect(r.state.configured).toMatchObject({ skippedEnv: ['APP_NAME', 'FEATURE_FLAG'], liaraJson: 'written', liaraignore: 'exists' });
    expect((w.ui as ScriptedUi).prompts.map((p) => p.kind)).toEqual(['password']);
  });

  it('known mount path → disks entry in liara.json', async () => {
    const w = await setup({ answers: [JWT, '', '', 'write'], deps: { mountPathFor: (f) => `/srv/app/${f}` } });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.state.configured?.diskMount).toBe('set');
    expect(JSON.parse(readFileSync(join(w.dir, 'liara.json'), 'utf8')).disks).toEqual([{ name: 'data', mountTo: '/srv/app/uploads' }]);
  });

  it('a UI without hidden input never asks for secrets in clear text', async () => {
    const texts: string[] = [];
    const ui: Prompter = {
      note: () => {},
      select: async (_m, o) => o[0]!.value,
      text: async (m) => {
        texts.push(m);
        return '';
      },
    };
    const w = await setup({ ui, disk: false });
    const r = await runPipeline(pipe(w.deps), { state: w.state });
    expect(r.state.configured?.skippedEnv).toContain('JWT_SECRET');
    expect(texts.some((t) => t.includes('JWT_SECRET'))).toBe(false);
    expect(existsSync(join(w.dir, '.liaraignore'))).toBe(true);
  });
});
