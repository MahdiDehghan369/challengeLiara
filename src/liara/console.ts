import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { redactText } from '../safety/redact.js';
import { ExternalCommandError } from '../shared/errors.js';
import type { Logger } from 'pino';
import { logger as rootLogger } from '../shared/logger.js';
import type { AppsApi } from './api/apps.js';
import type { LiaraCli } from './cli.js';

/**
 * Runs a command inside an app container (T1.15). Primary path: the console WebSocket
 * `wss://api.liara.ir?token=&cmd=/bin/bash&project_id=<id>` (+ `teamID`). Fallback: `liara shell -a <app> -c`.
 * The URL carries the API token, so it is never logged or put into errors.
 *
 * TODO(OQ-23): the console frame protocol is undocumented. Until T0.8 records it, input is sent as a
 * raw text frame (`<command>; echo <sentinel>$?\n`), output frames are decoded as UTF-8 text, and the
 * sentinel line gives the exit code; otherwise output is collected until the socket closes or times out.
 */

export const CONSOLE_DEFAULT_TIMEOUT_MS = 15_000;
export const CONSOLE_MAX_OUTPUT = 200_000;

export interface ConsoleResult {
  /** Combined output, ANSI-stripped and redacted. */
  stdout: string;
  exitCode: number | undefined;
  timedOut: boolean;
  via: 'ws' | 'cli';
}

/** Minimal WebSocket surface used here (the `ws` client implements it; tests may inject another). */
export interface ConsoleSocket {
  on(event: 'open', cb: () => void): unknown;
  on(event: 'message', cb: (data: unknown) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  send(data: string): void;
  terminate(): void;
}

export type ConsoleSocketFactory = (url: string) => ConsoleSocket;

export interface LiaraConsoleOptions {
  token: string;
  teamId?: string | undefined;
  apps: Pick<AppsApi, 'resolveApp'>;
  cli?: Pick<LiaraCli, 'shell'>;
  /** Default `wss://api.liara.ir`. */
  wsBase?: string;
  socketFactory?: ConsoleSocketFactory;
  logger?: Logger;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

function decode(data: unknown): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return String(data);
}

/** Error raised when the socket could not be used at all (→ CLI fallback). */
class ConsoleUnavailable extends Error {}

export class LiaraConsole {
  private readonly log: Logger;
  private readonly wsBase: string;
  private readonly socketFactory: ConsoleSocketFactory;

  constructor(private readonly opts: LiaraConsoleOptions) {
    this.log = (opts.logger ?? rootLogger).child({ mod: 'liara-console' });
    this.wsBase = opts.wsBase ?? 'wss://api.liara.ir';
    this.socketFactory = opts.socketFactory ?? ((url) => new WebSocket(url) as unknown as ConsoleSocket);
  }

  /** Never log this: it contains the token. */
  private url(projectId: string): string {
    const u = new URL(this.wsBase);
    u.searchParams.set('token', this.opts.token);
    u.searchParams.set('cmd', '/bin/bash');
    u.searchParams.set('project_id', projectId);
    if (this.opts.teamId) u.searchParams.set('teamID', this.opts.teamId);
    return u.toString();
  }

  private clean(text: string): string {
    const scrubbed = this.opts.token ? text.split(this.opts.token).join('[REDACTED]') : text;
    return redactText(scrubbed.replace(ANSI_RE, '').replace(/\r\n?/g, '\n'));
  }

  async runInContainer(app: string, command: string, opts: { timeoutMs?: number } = {}): Promise<ConsoleResult> {
    const timeoutMs = opts.timeoutMs ?? CONSOLE_DEFAULT_TIMEOUT_MS;
    const { id } = await this.opts.apps.resolveApp(app);
    try {
      return await this.runViaWs(id, command, timeoutMs);
    } catch (e) {
      if (!(e instanceof ConsoleUnavailable) || !this.opts.cli) throw e;
      this.log.debug({ app, reason: this.clean(e.message) }, 'console ws unavailable, falling back to liara shell');
      return this.runViaCli(app, command, timeoutMs);
    }
  }

  /** WebSocket path. The timeout always terminates the socket. */
  runViaWs(projectId: string, command: string, timeoutMs: number): Promise<ConsoleResult> {
    const nonce = randomBytes(6).toString('hex');
    const marker = `__SIAVASH_EXIT_${nonce}_`;
    const markerRe = new RegExp(`${marker}(\\d+)__`);
    this.log.debug({ projectId, timeoutMs }, 'console ws run');

    return new Promise<ConsoleResult>((resolve, reject) => {
      let out = '';
      let opened = false;
      let settled = false;
      let socket: ConsoleSocket;

      const finish = (r: { exitCode: number | undefined; timedOut: boolean } | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket?.terminate();
        } catch {
          // already closed
        }
        if (r instanceof Error) return reject(r);
        resolve({ stdout: this.clean(this.stripEcho(out, marker)), exitCode: r.exitCode, timedOut: r.timedOut, via: 'ws' });
      };

      const timer = setTimeout(() => finish({ exitCode: undefined, timedOut: true }), timeoutMs);

      try {
        socket = this.socketFactory(this.url(projectId));
      } catch (e) {
        clearTimeout(timer);
        settled = true;
        reject(new ConsoleUnavailable(this.clean((e as Error).message)));
        return;
      }

      socket.on('open', () => {
        opened = true;
        socket.send(`${command}; echo ${marker}$?__\n`);
      });
      socket.on('message', (data) => {
        if (out.length < CONSOLE_MAX_OUTPUT) out += decode(data);
        const m = markerRe.exec(out.replace(ANSI_RE, ''));
        if (m) finish({ exitCode: Number(m[1]), timedOut: false });
      });
      socket.on('close', () => finish({ exitCode: undefined, timedOut: false }));
      socket.on('error', (err) => {
        // before open → the console is unreachable (auth, network): let the caller fall back
        finish(opened ? new ExternalCommandError(this.clean(err.message), { details: { via: 'ws' } }) : new ConsoleUnavailable(this.clean(err.message)));
      });
    });
  }

  /** Removes the echoed input line and the sentinel line from the output. */
  private stripEcho(out: string, marker: string): string {
    return out
      .replace(ANSI_RE, '')
      .split(/\r?\n/)
      .filter((l) => !l.includes(marker))
      .join('\n')
      .trim();
  }

  private async runViaCli(app: string, command: string, timeoutMs: number): Promise<ConsoleResult> {
    const cli = this.opts.cli as Pick<LiaraCli, 'shell'>;
    try {
      const r = await cli.shell(app, command, { timeoutMs });
      return { stdout: this.clean(r.stdout).trim(), exitCode: r.exitCode, timedOut: false, via: 'cli' };
    } catch (e) {
      if (e instanceof ExternalCommandError) {
        const tail = (e.details.tail as string[] | undefined) ?? [];
        return {
          stdout: this.clean(tail.join('\n')),
          exitCode: e.exitCode,
          timedOut: e.details.timedOut === true,
          via: 'cli',
        };
      }
      throw e;
    }
  }
}
