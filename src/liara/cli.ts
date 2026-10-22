import { execa } from 'execa';
import type { Logger } from 'pino';
import { ExternalCommandError, ValidationError } from '../shared/errors.js';
import { logger as rootLogger } from '../shared/logger.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { LogsCli } from './api/logs.js';
import { extractJson, parseDeployLine, parseEnvListJson, stripAnsi, type DeployStage, type EnvVar } from './cli-parsers.js';

export const CLI_DEFAULT_TIMEOUT_MS = 60_000;
export const CLI_DEPLOY_TIMEOUT_MS = 15 * 60_000;
const TAIL_LINES = 50;

export interface SpawnResult {
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SpawnedProcess {
  /** Merged stdout+stderr lines as they arrive. */
  lines: AsyncIterable<string>;
  result: Promise<SpawnResult>;
  kill(): void;
}

export interface SpawnOptions {
  cwd?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Process spawner; the default uses execa. Injected in tests. */
export type Spawner = (file: string, args: string[], opts: SpawnOptions) => SpawnedProcess;

export const execaSpawner: Spawner = (file, args, opts) => {
  const sub = execa(file, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs,
    reject: false,
    all: true,
    stdin: 'ignore',
    ...(opts.signal ? { cancelSignal: opts.signal } : {}),
  });
  return {
    lines: sub.iterable({ from: 'all' }) as AsyncIterable<string>,
    result: sub.then((r) => ({
      exitCode: r.exitCode,
      stdout: typeof r.stdout === 'string' ? r.stdout : '',
      stderr: typeof r.stderr === 'string' ? r.stderr : '',
      timedOut: r.timedOut,
    })),
    kill: () => {
      sub.kill();
    },
  };
};

export interface LiaraCliOptions {
  token: string;
  teamId?: string | undefined;
  spawner?: Spawner;
  logger?: Logger;
}

export interface RunOptions {
  json?: boolean;
  timeoutMs?: number;
  cwd?: string;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
}

export interface RunResult<T = unknown> {
  stdout: string;
  stderr: string;
  exitCode: number;
  json?: T;
}

export interface CliInfo {
  available: boolean;
  viaNpx: boolean;
  version: string | undefined;
  hintFa: string | undefined;
}

export interface DeployOptions {
  cwd: string;
  app: string;
  port: number;
  platform?: string;
  disks?: Array<{ name: string; mountTo: string }>;
  message?: string;
  buildLocation?: 'iran' | 'germany';
  detach?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type DeployEvent =
  | { type: 'line'; line: string; stage?: DeployStage; percent?: number }
  | { type: 'stage'; stage: DeployStage }
  | { type: 'version'; version: string }
  | { type: 'done'; version: string | undefined; exitCode: number }
  | { type: 'failed'; exitCode: number | undefined; timedOut: boolean; tail: string[] };

export interface DbCreateInput {
  name: string;
  type: string;
  version?: string;
  plan: string;
  featurePlan?: string;
  publicNetwork?: boolean;
  network?: string;
}

/**
 * Wrapper around `@liara/cli`. Always adds `--api-token` (and `--team-id`); the token is scrubbed
 * from logged args, returned output and errors.
 */
export class LiaraCli implements LogsCli {
  private readonly token: string;
  private readonly teamId: string | undefined;
  private readonly spawner: Spawner;
  private readonly log: Logger;
  private bin: string[] = ['liara'];

  constructor(opts: LiaraCliOptions) {
    this.token = opts.token;
    this.teamId = opts.teamId || undefined;
    this.spawner = opts.spawner ?? execaSpawner;
    this.log = (opts.logger ?? rootLogger).child({ mod: 'liara-cli' });
  }

  /** Removes the token from any text (args, output, error messages). */
  scrub(text: string): string {
    return this.token ? text.split(this.token).join('[REDACTED]') : text;
  }

  private authArgs(): string[] {
    return ['--api-token', this.token, ...(this.teamId ? ['--team-id', this.teamId] : [])];
  }

  private displayArgs(args: string[]): string[] {
    return args.map((a) => this.scrub(a));
  }

  /** Checks `liara -v`; falls back to `npx -y @liara/cli`. */
  async ensureCli(): Promise<CliInfo> {
    for (const [bin, viaNpx] of [
      [['liara'], false],
      [['npx', '-y', '@liara/cli'], true],
    ] as const) {
      try {
        const p = this.spawner(bin[0] as string, [...bin.slice(1), '-v'], { timeoutMs: 120_000 });
        for await (const _ of p.lines) {
          // drain
        }
        const r = await p.result;
        if (r.exitCode === 0) {
          this.bin = [...bin];
          const version = /(\d+\.\d+\.\d+)/.exec(r.stdout)?.[1];
          return { available: true, viaNpx, version, hintFa: viaNpx ? fa.cli.usingNpx : undefined };
        }
      } catch {
        // try next
      }
    }
    return { available: false, viaNpx: false, version: undefined, hintFa: fa.cli.notInstalled };
  }

  private spawn(args: string[], opts: { cwd?: string; timeoutMs: number; signal?: AbortSignal }): SpawnedProcess {
    const full = [...this.bin.slice(1), ...args, ...this.authArgs()];
    this.log.debug({ cmd: this.bin[0], args: this.displayArgs(full) }, 'liara cli');
    return this.spawner(this.bin[0] as string, full, opts);
  }

  private fail(args: string[], r: SpawnResult, lines: string[]): ExternalCommandError {
    const tail = lines.slice(-TAIL_LINES).map((l) => this.scrub(l));
    return new ExternalCommandError(
      this.scrub(`liara ${args[0] ?? ''} exited with ${r.timedOut ? 'timeout' : String(r.exitCode)}`),
      {
        ...(r.exitCode === undefined ? {} : { exitCode: r.exitCode }),
        messageFa: r.timedOut ? fa.cli.timeout : fa.cli.failed,
        details: { args: this.displayArgs(args), tail, timedOut: r.timedOut },
        retryable: r.timedOut,
      },
    );
  }

  /** Runs `liara <args>` to completion. Non-zero exit → ExternalCommandError with the last 50 lines. */
  async run<T = unknown>(args: string[], opts: RunOptions = {}): Promise<RunResult<T>> {
    const finalArgs = opts.json ? [...args, '--output', 'json'] : args;
    const p = this.spawn(finalArgs, {
      timeoutMs: opts.timeoutMs ?? CLI_DEFAULT_TIMEOUT_MS,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const lines: string[] = [];
    for await (const raw of p.lines) {
      const line = this.scrub(raw);
      lines.push(line);
      opts.onLine?.(line);
    }
    const r = await p.result;
    if (r.exitCode !== 0 || r.timedOut) throw this.fail(finalArgs, r, lines);
    const out: RunResult<T> = { stdout: this.scrub(r.stdout), stderr: this.scrub(r.stderr), exitCode: 0 };
    if (opts.json) {
      try {
        out.json = extractJson(out.stdout) as T;
      } catch (cause) {
        throw new ValidationError(`liara ${args[0] ?? ''}: output is not JSON`, {
          messageFa: fa.cli.badJson,
          details: { args: this.displayArgs(finalArgs) },
          cause,
        });
      }
    }
    return out;
  }

  /** LogsCli: yields lines as they arrive (used by `liara logs -f`). */
  async *streamLines(args: string[], signal?: AbortSignal): AsyncIterable<string> {
    const p = this.spawn(args, { timeoutMs: 24 * 3600_000, ...(signal ? { signal } : {}) });
    try {
      for await (const raw of p.lines) yield this.scrub(raw);
    } finally {
      p.kill();
    }
  }

  // ---- ready-made commands -------------------------------------------------

  /** `liara plan:list --output json` — raw JSON; structure is OQ-5 (parsed in T4.6). */
  async planList(): Promise<unknown> {
    return (await this.run(['plan:list'], { json: true })).json;
  }

  /** `liara env:list -a <app> --output json` → values wrapped in Secret. */
  async envList(app: string): Promise<EnvVar[]> {
    const { json } = await this.run(['env:list', '-a', app], { json: true });
    return parseEnvListJson(json);
  }

  /** `liara env:unset KEY... -a <app> -f`. */
  async envUnset(app: string, keys: string[]): Promise<void> {
    await this.run(['env:unset', ...keys, '-a', app, '-f']);
  }

  async dbCreate(input: DbCreateInput): Promise<RunResult> {
    const args = ['db', 'create', '-n', input.name, '-t', input.type, '--plan', input.plan];
    if (input.version) args.push('-v', input.version);
    if (input.featurePlan) args.push('--feature-plan', input.featurePlan);
    if (input.publicNetwork) args.push('--public-network');
    if (input.network) args.push('--network', input.network);
    args.push('-y');
    return this.run(args, { timeoutMs: 10 * 60_000 });
  }

  /**
   * `liara db list --output json` — raw JSON. Recorded in T0.5: with no databases the CLI exits
   * non-zero with "Not found any database." → returned as `[]`.
   */
  async dbList(): Promise<unknown> {
    try {
      return (await this.run(['db', 'list'], { json: true })).json;
    } catch (e) {
      const tail = e instanceof ExternalCommandError ? ((e.details.tail as string[] | undefined) ?? []) : [];
      if (tail.some((l) => /not found any database/i.test(l))) return [];
      throw e;
    }
  }

  async dbStart(name: string): Promise<RunResult> {
    return this.run(['db', 'start', '-n', name]);
  }

  async dbStop(name: string): Promise<RunResult> {
    return this.run(['db', 'stop', '-n', name]);
  }

  /** `liara db resize -n <name> --plan <plan> [-d y]` — `-d y` confirms a disk increase. */
  async dbResize(name: string, plan: string, opts: { confirmDiskIncrease?: boolean } = {}): Promise<RunResult> {
    const args = ['db', 'resize', '-n', name, '--plan', plan];
    if (opts.confirmDiskIncrease) args.push('-d', 'y');
    return this.run(args, { timeoutMs: 10 * 60_000 });
  }

  async dbRemove(name: string): Promise<RunResult> {
    return this.run(['db', 'remove', '-n', name, '-y']);
  }

  /** `liara logs -a <app> [-s since] [-r version] -t` once (not following). */
  async logs(app: string, opts: { since?: string; release?: string } = {}): Promise<string> {
    const args = ['logs', '-a', app, '-t'];
    if (opts.since) args.push('-s', opts.since);
    if (opts.release) args.push('-r', opts.release);
    return (await this.run(args)).stdout;
  }

  /** `liara shell -a <app> -c <cmd>`. */
  async shell(app: string, command: string, opts: { timeoutMs?: number } = {}): Promise<RunResult> {
    return this.run(['shell', '-a', app, '-c', command], { timeoutMs: opts.timeoutMs ?? 15_000 });
  }

  /** `liara zone check -z <zone>`. */
  async zoneCheck(zone: string): Promise<RunResult> {
    return this.run(['zone', 'check', '-z', zone]);
  }

  /** `liara deploy ...` streamed as events; ends with exactly one `done` or `failed`. */
  async *deploy(opts: DeployOptions): AsyncIterable<DeployEvent> {
    const args = ['deploy', '--app', opts.app, '--path', opts.cwd, '--port', String(opts.port), '--no-app-logs'];
    if (opts.platform) args.push('--platform', opts.platform);
    if (opts.message) args.push('--message', opts.message);
    if (opts.buildLocation) args.push('--build-location', opts.buildLocation);
    if (opts.detach) args.push('--detach');
    for (const d of opts.disks ?? []) args.push('--disks', `${d.name}=${d.mountTo}`);

    const p = this.spawn(args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs ?? CLI_DEPLOY_TIMEOUT_MS,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const lines: string[] = [];
    let stage: DeployStage | undefined;
    let version: string | undefined;
    for await (const raw of p.lines) {
      const line = this.scrub(stripAnsi(raw));
      lines.push(line);
      const info = parseDeployLine(line);
      yield {
        type: 'line',
        line,
        ...(info.stage ? { stage: info.stage } : {}),
        ...(info.percent === undefined ? {} : { percent: info.percent }),
      };
      if (info.stage && info.stage !== stage && info.stage !== 'done' && info.stage !== 'failed') {
        stage = info.stage;
        yield { type: 'stage', stage };
      }
      if (info.version && info.version !== version) {
        version = info.version;
        yield { type: 'version', version };
      }
    }
    const r = await p.result;
    if (r.exitCode === 0 && !r.timedOut) yield { type: 'done', version, exitCode: 0 };
    else yield { type: 'failed', exitCode: r.exitCode, timedOut: r.timedOut, tail: lines.slice(-TAIL_LINES) };
  }
}
