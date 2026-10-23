import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { PipelineEvent } from '../../../src/deploy/pipeline-engine.js';
import { createLiaraClient, type LiaraClient } from '../../../src/liara/index.js';
import { MockLlm } from '../../../src/llm/index.js';
import { ScriptedApprover, type Approver } from '../../../src/safety/approval.js';
import { AuditLog } from '../../../src/safety/audit.js';
import { DEFAULT_POLICY } from '../../../src/safety/policy.js';
import { CliApprover } from '../../../src/ui/cli/approver.js';
import { parseDuration, parseEnvPair, parseOnOff, runCli } from '../../../src/ui/cli/program.js';
import { buildCliRegistry, readCredentials, type CliRuntime } from '../../../src/ui/cli/runtime.js';
import { ScriptedUi, type ScriptedAnswer } from '../../../src/ui/cli/scripted-ui.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-cli-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

function world(opts: { answers?: ScriptedAnswer[]; approver?: (ui: ScriptedUi) => Approver; cwd?: string } = {}) {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const config = { liara: { token: undefined, teamId: undefined, mode: 'mock' as const }, llm: { apiKey: undefined, mode: 'mock' as const }, dataDir, logLevel: 'silent' as const, deployMode: 'cli' as const };
  const liara = createLiaraClient(config, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const app = liara.mock!.state.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  liara.mock!.state.createRelease(app, { sourceID: liara.mock!.state.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  const ui = new ScriptedUi(opts.answers ?? []);
  const approver = opts.approver ? opts.approver(ui) : new ScriptedApprover(['approved']);
  const out: string[] = [];
  const err: string[] = [];
  const urlFor = (n: string) => liara.mock!.servers.urlFor(n);
  const pipelineEvents: { sink?: (e: PipelineEvent) => void } = {};
  const registry = buildCliRegistry({ config, liara, ui, urlFor, onPipelineEvent: (e) => pipelineEvents.sink?.(e) });
  const rt: CliRuntime = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ui,
    approver: () => approver,
    credentialsPath: join(dataDir, '..', 'home', 'credentials'),
    cwd: opts.cwd ?? join(dataDir, '..'),
    isTTY: false,
    services: async () => ({
      pipelineEvents,
      config,
      liara,
      llm: new MockLlm(),
      registry,
      audit: new AuditLog(dataDir),
      policy: DEFAULT_POLICY,
      urlFor,
    }),
  };
  return { rt, out, err, ui, approver, liara, mock: liara.mock!.state, run: (...argv: string[]) => runCli(rt, argv) };
}

describe('CLI parsing helpers', () => {
  it('durations, on/off and env pairs', () => {
    expect([parseDuration('90'), parseDuration('15m'), parseDuration('2h'), parseDuration('1d')]).toEqual([90, 900, 7200, 86400]);
    expect(() => parseDuration('soon')).toThrow();
    expect([parseOnOff('on'), parseOnOff('off')]).toEqual([true, false]);
    expect(() => parseOnOff('yes')).toThrow();
    expect(parseEnvPair('A_B=x=y')).toEqual({ key: 'A_B', value: 'x=y' });
    expect(parseEnvPair('TOKEN')).toEqual({ key: 'TOKEN' });
    expect(() => parseEnvPair('1BAD=x')).toThrow();
  });
});

describe('siavash CLI (T9.2)', { timeout: 60_000 }, () => {
  it('--help is Persian and sorted; every command shows an example', async () => {
    const w = world();
    expect(await w.run('--help')).toBe(0);
    const help = w.out.join('\n');
    expect(help).toContain('استفاده:');
    expect(help).toContain('دستورها:');
    const section = help.split('دستورها:')[1]!.split(/\n\S/)[0]!;
    const cmds = [...section.matchAll(/^ {2}([a-z]+)\b/gm)].map((m) => m[1]!).filter((n) => n !== 'help');
    expect(cmds).toEqual([...cmds].sort());
    for (const name of ['deploy', 'status', 'logs', 'doctor', 'env', 'rollback', 'settings', 'backup', 'mcp']) expect(cmds).toContain(name);

    const d = world();
    expect(await d.run('deploy', '--help')).toBe(0);
    expect(d.out.join('\n')).toMatch(/مثال:\n\s+siavash deploy \./);
    const e = world();
    await e.run('env', 'set', '--help');
    expect(e.out.join('\n')).toContain('siavash env set NODE_ENV=production --app shop');
  });

  it('status --json prints the overview; the app comes from .siavash/project.json when not given', async () => {
    const cwd = join(mkdtempSync(join(root, 'p-')));
    mkdirSync(join(cwd, '.siavash'), { recursive: true });
    writeFileSync(join(cwd, '.siavash', 'project.json'), JSON.stringify({ app: 'shop' }));
    const w = world({ cwd });
    expect(await w.run('status', '--json')).toBe(0);
    const o = JSON.parse(w.out.join('\n')) as { app: string; status: { ok: boolean; value: { name: string } } };
    expect(o.app).toBe('shop');
    expect(o.status.value.name).toBe('shop');
  });

  it('without --app or project.json the user picks from the app list', async () => {
    const w = world({ answers: [{ match: /کدام اپ/, answer: 'shop' }] });
    expect(await w.run('events')).toBe(0);
    expect(w.ui.remaining).toBe(0);
  });

  it('--yes approves R1 only: restart runs, stop (R2) is refused without a human', async () => {
    const yes = (ui: ScriptedUi) => new CliApprover({ yes: true, interactive: false, prompter: ui, color: false });
    const w = world({ approver: yes });
    expect(await w.run('restart', 'shop', '--yes')).toBe(0);
    const s = world({ approver: yes });
    expect(await s.run('stop', 'shop', '--yes')).toBe(1);
    expect(s.err.join('\n')).toContain('انجام نشد');
    await s.mock.settle();
    expect(s.mock.apps.get('shop')?.scale).toBe(1);
  });

  it('--dry-run shows the card and changes nothing', async () => {
    const w = world();
    await w.mock.settle();
    const before = w.mock.apps.get('shop')!.events.length;
    expect(await w.run('--dry-run', 'restart', 'shop')).toBe(0);
    expect(w.out.join('\n')).toContain('اجرای آزمایشی');
    await w.mock.settle();
    expect(w.mock.apps.get('shop')!.events.length).toBe(before);
    expect((w.approver as ScriptedApprover).seen).toEqual([]);
  });

  it('env set asks a missing value hidden; env list shows masked values only', async () => {
    const w = world({ answers: [{ match: /API_SECRET/, answer: 'very-secret-value-123' }] });
    expect(await w.run('env', 'set', 'NODE_ENV=production', 'API_SECRET', '--app', 'shop')).toBe(0);
    expect(w.mock.apps.get('shop')!.envs.get('API_SECRET')).toBe('very-secret-value-123');
    expect(w.ui.prompts[0]).toMatchObject({ kind: 'password', answer: '••••' });
    const l = world();
    l.mock.apps.get('shop')!.envs.set('API_SECRET', 'very-secret-value-123');
    expect(await l.run('env', 'list', 'shop')).toBe(0);
    expect(l.out.join('\n')).toContain('API_SECRET=');
    expect(l.out.join('\n')).not.toContain('very-secret-value-123');
  });

  it('rollback goes through the registry: one approval card, ledger updated', async () => {
    const w = world();
    const app = w.mock.apps.get('shop')!;
    const good = w.mock.addSource(app, 1024);
    w.liara.ledger.record({ app: 'shop', mode: 'api', sourceID: good, port: 3000, platform: 'node', result: 'success', startedAt: new Date(Date.now() - 3_600_000).toISOString() });
    w.liara.ledger.record({ app: 'shop', mode: 'cli', result: 'success', startedAt: new Date().toISOString() });
    expect(await w.run('rollback', 'shop')).toBe(0);
    const seen = (w.approver as ScriptedApprover).seen;
    expect(seen.map((p) => p.toolName)).toEqual(['rollback_app']);
    expect(w.liara.ledger.latest('shop')?.rollbackOf).toBeDefined();
  });

  it('login validates the token before storing it, and never prints it', async () => {
    const w = world({ answers: [{ match: /توکن/, answer: 'tok-abc-123456' }, { match: /تیم/, answer: '' }] });
    expect(await w.run('login')).toBe(0);
    expect(readCredentials(w.rt.credentialsPath)).toEqual({ token: 'tok-abc-123456' });
    expect([...w.out, ...w.err].join('\n')).not.toContain('tok-abc-123456');
  });

  it('commands that are not ready say so instead of failing silently', async () => {
    const w = world();
    expect(await w.run('watch', 'shop')).toBe(0);
    expect(w.out.join('\n')).toContain('هنوز آماده نیست');
  });
});
