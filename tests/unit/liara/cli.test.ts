import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { LiaraCli, type SpawnResult, type Spawner } from '../../../src/liara/cli.js';
import { extractJson, parseDeployLine, parseEnvListJson } from '../../../src/liara/cli-parsers.js';
import { ExternalCommandError, ValidationError } from '../../../src/shared/errors.js';
import { createLogger } from '../../../src/shared/logger.js';

const TOKEN = 'liara-test-token-0123456789abcdef';

interface Call {
  file: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
}

/** Fake spawner: each call consumes the next scripted result. */
function fakeSpawner(script: Array<{ lines: string[]; exitCode?: number; timedOut?: boolean; stdout?: string }>) {
  const calls: Call[] = [];
  let i = 0;
  const spawner: Spawner = (file, args, opts) => {
    calls.push({ file, args, ...(opts.cwd ? { cwd: opts.cwd } : {}), timeoutMs: opts.timeoutMs });
    const s = script[Math.min(i++, script.length - 1)] ?? { lines: [] };
    const result: SpawnResult = {
      exitCode: s.timedOut ? undefined : (s.exitCode ?? 0),
      stdout: s.stdout ?? s.lines.join('\n'),
      stderr: '',
      timedOut: s.timedOut ?? false,
    };
    return {
      lines: (async function* () {
        for (const l of s.lines) yield l;
      })(),
      result: Promise.resolve(result),
      kill: () => {},
    };
  };
  return { spawner, calls };
}

function capturingLogger() {
  const out: string[] = [];
  const logger = createLogger({
    level: 'trace',
    destination: new Writable({
      write(c, _e, cb) {
        out.push(String(c));
        cb();
      },
    }),
  });
  return { logger, out };
}

describe('LiaraCli.run', () => {
  it('always appends --api-token and --team-id', async () => {
    const { spawner, calls } = fakeSpawner([{ lines: ['ok'] }]);
    const cli = new LiaraCli({ token: TOKEN, teamId: 'team-7', spawner });
    await cli.run(['app:list']);
    expect(calls[0]?.file).toBe('liara');
    expect(calls[0]?.args).toEqual(['app:list', '--api-token', TOKEN, '--team-id', 'team-7']);
  });

  it('never writes the token to logs, outputs or errors', async () => {
    const { logger, out } = capturingLogger();
    const { spawner } = fakeSpawner([
      { lines: [`echo ${TOKEN}`], stdout: `token is ${TOKEN}` },
      { lines: ['boom', `failed with --api-token ${TOKEN}`], exitCode: 2 },
    ]);
    const cli = new LiaraCli({ token: TOKEN, spawner, logger });
    const seen: string[] = [];
    const r = await cli.run(['env:list', '-a', 'x'], { onLine: (l) => seen.push(l) });
    expect(r.stdout).not.toContain(TOKEN);
    expect(seen.join('\n')).not.toContain(TOKEN);
    const e = (await cli.run(['restart']).catch((x: unknown) => x)) as ExternalCommandError;
    expect(e).toBeInstanceOf(ExternalCommandError);
    expect(JSON.stringify({ m: e.message, d: e.details })).not.toContain(TOKEN);
    expect(out.join('')).not.toContain(TOKEN);
    expect(out.join('')).toContain('[REDACTED]');
  });

  it('non-zero exit → ExternalCommandError with the last 50 lines', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`);
    const { spawner } = fakeSpawner([{ lines, exitCode: 1 }]);
    const e = (await new LiaraCli({ token: TOKEN, spawner })
      .run(['deploy'])
      .catch((x: unknown) => x)) as ExternalCommandError;
    expect(e.exitCode).toBe(1);
    const tail = e.details.tail as string[];
    expect(tail).toHaveLength(50);
    expect(tail[0]).toBe('line 30');
    expect(tail[49]).toBe('line 79');
  });

  it('timeout → retryable ExternalCommandError', async () => {
    const { spawner } = fakeSpawner([{ lines: [], timedOut: true }]);
    const e = (await new LiaraCli({ token: TOKEN, spawner })
      .run(['logs'])
      .catch((x: unknown) => x)) as ExternalCommandError;
    expect(e.retryable).toBe(true);
    expect(e.details.timedOut).toBe(true);
  });

  it('json mode adds --output json and parses (tolerating banners)', async () => {
    const { spawner, calls } = fakeSpawner([
      { lines: [], stdout: 'Warning: update available\n[{"name":"db1"}]\n' },
      { lines: [], stdout: 'not json at all' },
    ]);
    const cli = new LiaraCli({ token: TOKEN, spawner });
    expect(await cli.dbList()).toEqual([{ name: 'db1' }]);
    expect(calls[0]?.args.slice(0, 4)).toEqual(['db', 'list', '--output', 'json']);
    await expect(cli.planList()).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('ready-made commands', () => {
  it('builds the documented argument lists', async () => {
    const { spawner, calls } = fakeSpawner([{ lines: [], stdout: '[]' }]);
    const cli = new LiaraCli({ token: TOKEN, spawner });
    await cli.envUnset('shop', ['A', 'B']);
    await cli.dbCreate({ name: 'db1', type: 'postgres', version: '16', plan: 'p1', featurePlan: 'free' });
    await cli.dbStart('db1');
    await cli.dbStop('db1');
    await cli.dbResize('db1', 'p2', { confirmDiskIncrease: true });
    await cli.dbRemove('db1');
    await cli.shell('shop', 'node -v');
    await cli.zoneCheck('example.com');
    await cli.logs('shop', { since: '1 hour ago', release: 'v3' });
    const strip = (a: string[]) => a.slice(0, a.indexOf('--api-token'));
    expect(calls.map((c) => strip(c.args))).toEqual([
      ['env:unset', 'A', 'B', '-a', 'shop', '-f'],
      ['db', 'create', '-n', 'db1', '-t', 'postgres', '--plan', 'p1', '-v', '16', '--feature-plan', 'free', '-y'],
      ['db', 'start', '-n', 'db1'],
      ['db', 'stop', '-n', 'db1'],
      ['db', 'resize', '-n', 'db1', '--plan', 'p2', '-d', 'y'],
      ['db', 'remove', '-n', 'db1', '-y'],
      ['shell', '-a', 'shop', '-c', 'node -v'],
      ['zone', 'check', '-z', 'example.com'],
      ['logs', '-a', 'shop', '-t', '-s', '1 hour ago', '-r', 'v3'],
    ]);
  });

  it('envList wraps values in Secret', async () => {
    const { spawner } = fakeSpawner([{ lines: [], stdout: '[{"key":"DATABASE_URL","value":"postgres://u:p@h/db"}]' }]);
    const envs = await new LiaraCli({ token: TOKEN, spawner }).envList('shop');
    expect(envs[0]?.key).toBe('DATABASE_URL');
    expect(JSON.stringify(envs)).not.toContain('postgres://');
    expect(envs[0]?.value.reveal()).toBe('postgres://u:p@h/db');
  });

  it('ensureCli prefers liara, falls back to npx, else reports not installed', async () => {
    const ok = fakeSpawner([{ lines: [], stdout: '@liara/cli/7.1.0 win32-x64 node-v22' }]);
    expect(await new LiaraCli({ token: TOKEN, spawner: ok.spawner }).ensureCli()).toMatchObject({
      available: true,
      viaNpx: false,
      version: '7.1.0',
    });
    const npx = fakeSpawner([{ lines: [], exitCode: 1 }, { lines: [], stdout: '7.0.0' }]);
    const cli = new LiaraCli({ token: TOKEN, spawner: npx.spawner });
    const info = await cli.ensureCli();
    expect(info).toMatchObject({ available: true, viaNpx: true });
    expect(info.hintFa).toBeDefined();
    await cli.run(['app:list']);
    expect(npx.calls[2]?.file).toBe('npx');
    expect(npx.calls[2]?.args.slice(0, 3)).toEqual(['-y', '@liara/cli', 'app:list']);
    const none = fakeSpawner([{ lines: [], exitCode: 127 }]);
    expect((await new LiaraCli({ token: TOKEN, spawner: none.spawner }).ensureCli()).available).toBe(false);
  });
});

describe('deploy', () => {
  const sample = [
    'Compressing files...',
    'Uploading 45%',
    'Uploading 100%',
    'Building...',
    'Step 1/5 : FROM node:22',
    'Pushing image...',
    'Creating release v3',
    'Deployed successfully',
  ];

  it('streams line/stage/version events and ends with done', async () => {
    const { spawner, calls } = fakeSpawner([{ lines: sample }]);
    const cli = new LiaraCli({ token: TOKEN, spawner });
    const events = [];
    for await (const e of cli.deploy({ cwd: '/proj', app: 'shop', port: 3000, platform: 'node', message: 'm' })) {
      events.push(e);
    }
    const stages = events.filter((e) => e.type === 'stage').map((e) => (e as { stage: string }).stage);
    expect(stages).toEqual(['upload', 'build', 'push', 'release']);
    expect(events.filter((e) => e.type === 'version')).toEqual([{ type: 'version', version: 'v3' }]);
    expect(events[events.length - 1]).toEqual({ type: 'done', version: 'v3', exitCode: 0 });
    expect(calls[0]?.cwd).toBe('/proj');
    expect(calls[0]?.timeoutMs).toBe(15 * 60_000);
    expect(calls[0]?.args).toContain('--no-app-logs');
  });

  it('non-zero exit ends with failed + tail, regardless of text', async () => {
    const { spawner } = fakeSpawner([{ lines: ['Building...', 'npm ERR! missing script: build'], exitCode: 1 }]);
    const events = [];
    for await (const e of new LiaraCli({ token: TOKEN, spawner }).deploy({ cwd: '.', app: 'a', port: 3000 })) {
      events.push(e);
    }
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'failed', exitCode: 1, timedOut: false });
    expect((last as { tail: string[] }).tail).toContain('npm ERR! missing script: build');
  });

  it.todo('stage regexes match the real `liara deploy` output (OQ-16) recorded in the T0.8 spike');
});

describe('parsers', () => {
  it('parseDeployLine extracts percent and stage', () => {
    expect(parseDeployLine('Uploading 45%')).toEqual({ stage: 'upload', percent: 45 });
    expect(parseDeployLine('Error: build failed').stage).toBe('failed');
    expect(parseDeployLine('random noise')).toEqual({});
  });

  it('parseEnvListJson accepts several shapes', () => {
    const keys = (j: unknown) => parseEnvListJson(j).map((e) => [e.key, e.value.reveal()]);
    expect(keys([{ key: 'A', value: '1' }])).toEqual([['A', '1']]);
    expect(keys([{ name: 'B', value: 2 }])).toEqual([['B', '2']]);
    expect(keys({ envs: [{ key: 'C', value: '' }] })).toEqual([['C', '']]);
    expect(keys({ D: 'x', E: 'y' })).toEqual([
      ['D', 'x'],
      ['E', 'y'],
    ]);
    expect(() => parseEnvListJson('nope')).toThrow();
  });

  it('extractJson', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('banner\n{"a":[1]}\ntrailer')).toEqual({ a: [1] });
    expect(() => extractJson('none')).toThrow();
  });
});
