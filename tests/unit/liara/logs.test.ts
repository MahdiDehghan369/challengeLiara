import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LiaraHttp } from '../../../src/liara/http.js';
import { LogsApi, parseCliLogLine, type LogLine, type LogsCli } from '../../../src/liara/api/logs.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const h = () => new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });
const NOW = Date.parse('2026-10-20T13:00:00.000Z');

const ESC = '\u001b';
const CLI_OUTPUT = [
  '2026-10-20T12:00:00.000000000Z shop-api listening on port 3000',
  `${ESC}[31m2026-10-20T12:00:05.250Z Error: connect ECONNREFUSED 127.0.0.1:5432${ESC}[0m`,
  '',
  'a line without timestamp',
].join('\n');

function fakeCli(stdout: string, calls: string[][]): LogsCli {
  return {
    run: async (args) => {
      calls.push(args);
      return { stdout };
    },
    async *streamLines(args) {
      calls.push(args);
      for (const l of stdout.split('\n')) yield l;
    },
  };
}

describe('LogsApi.getLogs', () => {
  it('parses the API fixture into LogLine', async () => {
    let since: string | null = null;
    server.use(
      http.get(`${BASE}/v1/projects/shop-api/logs`, ({ request }) => {
        since = new URL(request.url).searchParams.get('since');
        return HttpResponse.json(loadFixture('logs.json'));
      }),
    );
    const lines = await new LogsApi(h(), { now: () => NOW }).getLogs('shop-api', { windowSec: 3600 });
    expect(since).toBe(String((NOW - 3_600_000) / 1000));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toEqual({
      ts: Date.parse('2026-10-20T12:00:05.250Z'),
      stream: 'stderr',
      text: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
      source: 'api',
    });
  });

  it('since formats: unix-s (default), unix-ms, iso', () => {
    const ts = Date.parse('2026-10-20T12:00:00.500Z');
    expect(new LogsApi(h()).formatSince(ts)).toBe(String(Math.floor(ts / 1000)));
    expect(new LogsApi(h(), { sinceFormat: 'unix-ms' }).formatSince(ts)).toBe(String(ts));
    expect(new LogsApi(h(), { sinceFormat: 'iso' }).formatSince(ts)).toBe('2026-10-20T12:00:00.500Z');
  });

  it('accepts numeric datetimes (seconds or ms)', async () => {
    server.use(
      http.get(`${BASE}/v1/projects/a/logs`, () =>
        HttpResponse.json([
          { type: 'stdout', datetime: 1760961600, message: 's' },
          { type: 'stdout', datetime: '1760961600123', message: 'ms' },
        ]),
      ),
    );
    const lines = await new LogsApi(h()).getLogs('a');
    expect(lines.map((l) => l.ts)).toEqual([1760961600000, 1760961600123]);
  });

  it.todo('uses the confirmed `since` format (OQ-1) once BEHAVIOR §6 is known');
});

describe('LogsApi.tailLogs', () => {
  it('polls incrementally from the last ts and drops duplicates', async () => {
    const batches = [
      [
        { type: 'stdout', datetime: '2026-10-20T12:00:00.000Z', message: 'a' },
        { type: 'stdout', datetime: '2026-10-20T12:00:01.000Z', message: 'b' },
      ],
      [
        { type: 'stdout', datetime: '2026-10-20T12:00:01.000Z', message: 'b' },
        { type: 'stdout', datetime: '2026-10-20T12:00:02.000Z', message: 'c' },
      ],
      [{ type: 'stdout', datetime: '2026-10-20T12:00:02.000Z', message: 'c' }],
    ];
    const sinces: string[] = [];
    let call = 0;
    server.use(
      http.get(`${BASE}/v1/projects/a/logs`, ({ request }) => {
        sinces.push(new URL(request.url).searchParams.get('since') ?? '');
        return HttpResponse.json(batches[Math.min(call++, batches.length - 1)]);
      }),
    );
    const ac = new AbortController();
    const api = new LogsApi(h(), {
      sinceFormat: 'unix-ms',
      sleep: async () => {
        if (call >= 3) ac.abort();
      },
    });
    const got: LogLine[] = [];
    for await (const l of api.tailLogs('a', { sinceTs: 0, intervalMs: 1, signal: ac.signal })) got.push(l);
    expect(got.map((l) => l.text)).toEqual(['a', 'b', 'c']);
    expect(sinces).toEqual(['0', String(Date.parse('2026-10-20T12:00:01.000Z')), String(Date.parse('2026-10-20T12:00:02.000Z'))]);
  });
});

describe('CLI paths', () => {
  it('parseCliLogLine: timestamps, ANSI, blank and untimed lines', () => {
    expect(parseCliLogLine('')).toBeUndefined();
    expect(parseCliLogLine(`${ESC}[32m2026-10-20T12:00:00Z hello${ESC}[0m`)).toEqual({
      ts: Date.parse('2026-10-20T12:00:00Z'),
      stream: 'stdout',
      text: 'hello',
      source: 'cli',
    });
    expect(parseCliLogLine('no ts here')).toEqual({ ts: 0, stream: 'stdout', text: 'no ts here', source: 'cli' });
  });

  it('getLogsByRelease runs `logs -r` and returns the same LogLine type as the API', async () => {
    const calls: string[][] = [];
    const api = new LogsApi(h(), { cli: fakeCli(CLI_OUTPUT, calls) });
    const lines = await api.getLogsByRelease('shop-api', 'v2');
    expect(calls).toEqual([['logs', '-a', 'shop-api', '-t', '-r', 'v2']]);
    expect(lines).toHaveLength(3);
    expect(lines[1]?.text).toBe('Error: connect ECONNREFUSED 127.0.0.1:5432');
    expect(Object.keys(lines[0] as LogLine).sort()).toEqual(['source', 'stream', 'text', 'ts']);
  });

  it('followLogs streams `logs -f -t` lines', async () => {
    const calls: string[][] = [];
    const api = new LogsApi(h(), { cli: fakeCli(CLI_OUTPUT, calls) });
    const got: LogLine[] = [];
    for await (const l of api.followLogs('shop-api', { since: '1 hour ago' })) got.push(l);
    expect(calls[0]).toEqual(['logs', '-a', 'shop-api', '-f', '-t', '-s', '1 hour ago']);
    expect(got).toHaveLength(3);
  });

  it('throws if no CLI runner is configured', async () => {
    await expect(new LogsApi(h()).getLogsByRelease('a', 'v1')).rejects.toThrow(/CLI runner/);
  });

  it.todo('matches the real `liara logs -t` output format (OQ-14) once recorded in T0.5/T0.8');
});
