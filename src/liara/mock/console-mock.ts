import type { ConsoleSocket, ConsoleSocketFactory } from '../console.js';
import type { MockApp, MockLiaraState } from './state.js';

/**
 * Fake container shell shared by the console mock (WebSocket) and `liara shell` in the CLI mock.
 * Supports the handful of commands the agent uses for probing (env, pwd, ls, df, node -v, migrations).
 */
export function fakeShell(state: MockLiaraState, app: MockApp, command: string): { out: string; code: number } {
  const cmd = command.trim();
  if (app.scale === 0) return { out: 'error: container is not running', code: 1 };
  if (cmd === 'env' || cmd === 'printenv') {
    return { out: [...app.envs.entries()].map(([k, v]) => `${k}=${v}`).concat(['NODE_ENV=production', `PORT=${state.currentRelease(app)?.port ?? 3000}`]).join('\n'), code: 0 };
  }
  const printenv = /^printenv\s+(\w+)$/.exec(cmd);
  if (printenv) {
    const v = app.envs.get(printenv[1] as string);
    return v === undefined ? { out: '', code: 1 } : { out: v, code: 0 };
  }
  if (cmd === 'pwd') return { out: '/app', code: 0 };
  if (cmd === 'whoami') return { out: 'node', code: 0 };
  if (/^ls(\s|$)/.test(cmd)) return { out: 'index.js\nnode_modules\npackage.json', code: 0 };
  if (cmd === 'node -v' || cmd === 'node --version') return { out: 'v22.12.0', code: 0 };
  if (/^df(\s|$)/.test(cmd)) {
    const rows = app.disks.map((d) => {
      const pct = Math.round((d.usage / d.size) * 100);
      return `/dev/mock-${d.name}  ${d.size}G  ${d.usage.toFixed(1)}G  ${(d.size - d.usage).toFixed(1)}G  ${pct}% ${d.mountedTo ?? `/mnt/${d.name}`}`;
    });
    return { out: ['Filesystem  Size  Used  Avail  Use% Mounted on', 'overlay  5G  1.2G  3.8G  24% /', ...rows].join('\n'), code: 0 };
  }
  if (/manage\.py migrate|artisan migrate|prisma migrate deploy/.test(cmd)) return { out: 'No migrations to apply.', code: 0 };
  if (/^(true|:)$/.test(cmd)) return { out: '', code: 0 };
  if (/^false$/.test(cmd)) return { out: '', code: 1 };
  if (/^echo\s/.test(cmd)) return { out: cmd.slice(5).replace(/^['"]|['"]$/g, ''), code: 0 };
  if (/^cat\s/.test(cmd)) return { out: `cat: ${cmd.slice(4)}: No such file or directory`, code: 1 };
  return { out: `sh: 1: ${cmd.split(/\s+/)[0]}: not found`, code: 127 };
}

/**
 * Console WebSocket mock. Speaks the interim protocol of `LiaraConsole` (OQ-23): a raw text frame
 * `<cmd>; echo <sentinel>$?__\n` → echoed input, output, then the sentinel with the exit code.
 * Rejects connections without a token or with an unknown `project_id` (→ CLI fallback in LiaraConsole).
 */
export function createConsoleMock(state: MockLiaraState): ConsoleSocketFactory {
  return (url: string): ConsoleSocket => {
    const u = new URL(url);
    const app = state.findById(u.searchParams.get('project_id') ?? '');
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    const emit = (ev: string, ...a: unknown[]) => setTimeout(() => (handlers[ev] ?? []).forEach((h) => h(...a)), 0);
    let closed = false;
    const socket: ConsoleSocket = {
      on(event: string, cb: (...a: never[]) => void) {
        (handlers[event] ??= []).push(cb as (...a: unknown[]) => void);
        return socket;
      },
      send(data: string) {
        if (closed || !app) return;
        const m = /^([\s\S]*?); echo (__SIAVASH_EXIT_[0-9a-f]+_)\$\?__\n?$/.exec(data);
        const command = m ? (m[1] as string) : data.trim();
        const r = fakeShell(state, app, command);
        emit('message', Buffer.from(`root@${app.name}:/app# ${data}`));
        if (r.out) emit('message', Buffer.from(`${r.out}\r\n`));
        if (m) emit('message', Buffer.from(`${m[2]}${r.code}__\r\n`));
      },
      terminate() {
        if (closed) return;
        closed = true;
        emit('close');
      },
    } as ConsoleSocket;
    if (!u.searchParams.get('token') || !app) emit('error', new Error('Unexpected server response: 401'));
    else emit('open');
    return socket;
  };
}
