import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classifyProbeError, probe } from '../../../src/sre/health.js';
import { percentile } from '../../../src/shared/stats.js';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/health') return res.end('ok');
    if (req.url === '/boom') {
      res.statusCode = 500;
      return res.end('err');
    }
    if (req.url === '/slow') {
      setTimeout(() => res.end('late'), 400);
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('probe', () => {
  it('healthy path: 100% availability, latency stats, status histogram', async () => {
    const r = await probe(base, { paths: ['/health'], count: 4 });
    expect(r.total).toBe(4);
    expect(r.availability).toBe(100);
    expect(r.errorRate).toBe(0);
    expect(r.statusHistogram).toEqual({ 200: 4 });
    expect(r.p50).toBeGreaterThanOrEqual(0);
    expect(r.p95).toBeGreaterThanOrEqual(r.p50 as number);
    expect(r.tlsValid).toBeUndefined();
    expect(r.samples[0]?.ttfbMs).toBeDefined();
  });

  it('5xx lowers availability and raises errorRate; 404 counts as available', async () => {
    const r = await probe(base, { paths: ['/health', '/boom', '/missing'], count: 1 });
    expect(r.statusHistogram).toEqual({ 200: 1, 500: 1, 404: 1 });
    expect(r.availability).toBe(66.7);
    expect(r.errorRate).toBe(0.333);
  });

  it('timeout is reported separately', async () => {
    const r = await probe(base, { paths: ['/slow'], count: 1, timeoutMs: 50 });
    expect(r.errorHistogram.timeout).toBe(1);
    expect(r.samples[0]?.error).toBe('timeout');
    expect(r.availability).toBe(0);
  });

  it('DNS failure is reported separately', async () => {
    const r = await probe('http://siavash-nonexistent-host.invalid', { count: 1, timeoutMs: 5000 });
    expect(r.samples[0]?.error).toBe('dns');
    expect(r.errorHistogram.dns).toBe(1);
  });

  it('connection refused is a connection error', async () => {
    const closed = createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const r = await probe(`http://127.0.0.1:${port}`, { count: 1 });
    expect(r.samples[0]?.error).toBe('connection');
  });

  it('TLS errors are reported separately and mark tlsValid=false', async () => {
    const tlsFail = (async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('self signed'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }) });
    }) as unknown as typeof fetch;
    const r = await probe('https://shop.example', { count: 2, fetchImpl: tlsFail });
    expect(r.errorHistogram.tls).toBe(2);
    expect(r.tlsValid).toBe(false);
    expect(r.samples[0]?.errorCode).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
  });

  it('https success → tlsValid=true', async () => {
    const ok = (async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    expect((await probe('https://shop.example', { count: 1, fetchImpl: ok })).tlsValid).toBe(true);
  });
});

describe('classifyProbeError', () => {
  const wrap = (code: string) => new TypeError('fetch failed', { cause: Object.assign(new Error(code), { code }) });
  it.each([
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['CERT_HAS_EXPIRED', 'tls'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'tls'],
    ['ECONNREFUSED', 'connection'],
    ['ECONNRESET', 'connection'],
    ['UND_ERR_CONNECT_TIMEOUT', 'timeout'],
    ['WEIRD', 'other'],
  ])('%s → %s', (code, kind) => {
    expect(classifyProbeError(wrap(code)).kind).toBe(kind);
  });

  it('AbortSignal timeout', () => {
    expect(classifyProbeError(Object.assign(new Error('t'), { name: 'TimeoutError' })).kind).toBe('timeout');
  });
});

describe('percentile', () => {
  it('nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeUndefined();
  });
});
