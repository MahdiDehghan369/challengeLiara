import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import type { AppsApi } from '../../../src/liara/api/apps.js';
import { LiaraConsole } from '../../../src/liara/console.js';
import { ExternalCommandError } from '../../../src/shared/errors.js';

const TOKEN = 'console-test-token-123456';
const apps = { resolveApp: async () => ({ id: 'APPID123' }) } as unknown as Pick<AppsApi, 'resolveApp'>;

let wss: WebSocketServer | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (wss ? wss.close(() => r()) : r()));
  wss = undefined;
});

interface Seen {
  url: string | undefined;
  received: string[];
  closed: boolean;
}

async function server(onCommand: (sock: ServerSocket, cmd: string) => void, opts: { reject?: number } = {}) {
  const seen: Seen = { url: undefined, received: [], closed: false };
  wss = new WebSocketServer({
    port: 0,
    ...(opts.reject ? { verifyClient: (_info: unknown, cb: (ok: boolean, code?: number) => void) => cb(false, opts.reject) } : {}),
  });
  await new Promise<void>((r) => wss!.once('listening', () => r()));
  wss.on('connection', (sock, req) => {
    seen.url = req.url;
    sock.on('message', (d) => {
      const cmd = d.toString();
      seen.received.push(cmd);
      onCommand(sock, cmd);
    });
    sock.on('close', () => (seen.closed = true));
  });
  const port = (wss.address() as AddressInfo).port;
  return { seen, base: `ws://127.0.0.1:${port}` };
}

/** A fake bash: echoes the input, prints output, then the expanded sentinel. */
function bash(output: string, exit: number) {
  return (sock: ServerSocket, cmd: string) => {
    const marker = /echo (__SIAVASH_EXIT_[0-9a-f]+_)\$\?__/.exec(cmd)?.[1];
    sock.send(`\u001b[32mroot@app:/app#\u001b[0m ${cmd}`);
    sock.send(Buffer.from(`${output}\r\n`));
    sock.send(`${marker}${exit}__\r\n`);
  };
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
};

describe('LiaraConsole (WebSocket)', () => {
  it('runs a command, returns output + exit code; URL carries project_id/cmd/teamID', async () => {
    const { seen, base } = await server(bash('total 4\nindex.js', 0));
    const c = new LiaraConsole({ token: TOKEN, teamId: 'team9', apps, wsBase: base });
    const r = await c.runInContainer('shop', 'ls /app');
    expect(r).toEqual({ stdout: 'total 4\nindex.js', exitCode: 0, timedOut: false, via: 'ws' });
    const q = new URL(seen.url ?? '', 'ws://x').searchParams;
    expect(q.get('project_id')).toBe('APPID123');
    expect(q.get('cmd')).toBe('/bin/bash');
    expect(q.get('teamID')).toBe('team9');
    expect(q.get('token')).toBe(TOKEN);
    expect(seen.received[0]).toMatch(/^ls \/app; echo __SIAVASH_EXIT_[0-9a-f]+_\$\?__\n$/);
  });

  it('non-zero exit code is reported', async () => {
    const { base } = await server(bash('cat: nope: No such file or directory', 1));
    const r = await new LiaraConsole({ token: TOKEN, apps, wsBase: base }).runInContainer('shop', 'cat nope');
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('cat: nope: No such file or directory');
  });

  it('timeout always closes the connection', async () => {
    const { seen, base } = await server(() => {
      /* never answers */
    });
    const t0 = Date.now();
    const r = await new LiaraConsole({ token: TOKEN, apps, wsBase: base }).runInContainer('shop', 'sleep 100', { timeoutMs: 200 });
    expect(r).toMatchObject({ timedOut: true, exitCode: undefined, via: 'ws' });
    expect(Date.now() - t0).toBeLessThan(2000);
    await waitFor(() => seen.closed);
    expect(seen.closed).toBe(true);
  });

  it('server closing without the sentinel → output so far, no exit code', async () => {
    const { base } = await server((sock) => {
      sock.send('partial output\n');
      sock.close();
    });
    const r = await new LiaraConsole({ token: TOKEN, apps, wsBase: base }).runInContainer('shop', 'x');
    expect(r).toEqual({ stdout: 'partial output', exitCode: undefined, timedOut: false, via: 'ws' });
  });

  it('output is ANSI-stripped and redacted; the token never appears', async () => {
    const { base } = await server(bash(`DATABASE_URL=postgres://app:s3cretpw@db:5432/x\ntoken=${TOKEN}`, 0));
    const r = await new LiaraConsole({ token: TOKEN, apps, wsBase: base }).runInContainer('shop', 'env');
    expect(r.stdout).not.toContain('s3cretpw');
    expect(r.stdout).not.toContain(TOKEN);
    expect(r.stdout).not.toContain('\u001b');
  });
});

describe('LiaraConsole (OQ-23)', () => {
  it.todo('OQ-23: replay a recorded real console session (frame format, prompt, exit) once T0.8 records it');
});

describe('LiaraConsole (CLI fallback)', () => {
  it('ws rejected before open (401) → liara shell', async () => {
    const { base } = await server(() => {}, { reject: 401 });
    const calls: unknown[] = [];
    const cli = {
      shell: async (app: string, command: string, o?: { timeoutMs?: number }) => {
        calls.push([app, command, o]);
        return { stdout: 'v22.0.0\n', stderr: '', exitCode: 0 };
      },
    };
    const r = await new LiaraConsole({ token: TOKEN, apps, cli, wsBase: base }).runInContainer('shop', 'node -v', { timeoutMs: 5000 });
    expect(r).toEqual({ stdout: 'v22.0.0', exitCode: 0, timedOut: false, via: 'cli' });
    expect(calls).toEqual([['shop', 'node -v', { timeoutMs: 5000 }]]);
  });

  it('nothing listening → fallback; CLI non-zero exit → result with tail', async () => {
    const cli = {
      shell: async () => {
        throw new ExternalCommandError('liara shell exited with 2', { exitCode: 2, details: { tail: ['boom'], timedOut: false } });
      },
    };
    const r = await new LiaraConsole({ token: TOKEN, apps, cli, wsBase: 'ws://127.0.0.1:1' }).runInContainer('shop', 'false');
    expect(r).toEqual({ stdout: 'boom', exitCode: 2, timedOut: false, via: 'cli' });
  });

  it('no CLI available → the ws error propagates without the token', async () => {
    const e = await new LiaraConsole({ token: TOKEN, apps, wsBase: 'ws://127.0.0.1:1' })
      .runInContainer('shop', 'ls')
      .catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(Error);
    expect(String((e as Error).message)).not.toContain(TOKEN);
  });
});
