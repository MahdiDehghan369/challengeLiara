import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { classifyProbeError } from '../../../src/sre/health.js';
import { noKeepAlive } from '../../helpers/no-pool-fetch.js';

// a server that would happily keep connections alive
const ports: number[] = [];
const server = createServer((req, res) => {
  ports.push(req.socket.remotePort ?? -1);
  if (req.url === '/slow') return void setTimeout(() => res.end('late'), 500);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))));

describe('noKeepAlive test fetch (mock-liara flake fix)', () => {
  it('never reuses a socket, even when the server allows keep-alive', async () => {
    const a = await noKeepAlive(`${base}/`);
    const b = await noKeepAlive(`${base}/`);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual({ ok: true });
    expect(ports).toHaveLength(2);
    expect(ports[0]).not.toBe(ports[1]);
  });

  it('a timeout looks like fetch’s to the probe classifier', async () => {
    const err = await noKeepAlive(`${base}/slow`, { signal: AbortSignal.timeout(50) }).catch((e: unknown) => e);
    expect(classifyProbeError(err).kind).toBe('timeout');
  });

  it('a refused connection is classified as a connection error', async () => {
    const err = await noKeepAlive('http://127.0.0.1:1/').catch((e: unknown) => e);
    expect(classifyProbeError(err).kind).toBe('connection');
  });
});
