import { describe, expect, it } from 'vitest';
import type { LogLine } from '../../../src/liara/api/logs.js';
import { collectLogs, detectLevel, mergeMultiline, type LogSource } from '../../../src/sre/logs.js';

let t0 = Date.parse('2026-10-20T12:00:00Z');
const line = (text: string, stream = 'stdout'): LogLine => ({ ts: (t0 += 10), stream, text, source: 'api' });
const source = (lines: LogLine[]): LogSource => ({ getLogs: async () => lines });

const NODE_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  '    at getOrder (/app/src/routes/orders.js:42:17)',
  '    at Layer.handle [as handle_request] (/app/node_modules/express/lib/router/layer.js:95:5)',
  '    at next (/app/node_modules/express/lib/router/route.js:149:13)',
];

const PY_TRACE = [
  'Traceback (most recent call last):',
  '  File "/app/main.py", line 12, in <module>',
  '    db = connect(os.environ["DATABASE_URL"])',
  '  File "/usr/lib/python3.12/os.py", line 685, in __getitem__',
  '    raise KeyError(key) from None',
  "KeyError: 'DATABASE_URL'",
];

describe('mergeMultiline', () => {
  it('a Node stack trace becomes one record', () => {
    const merged = mergeMultiline([line('server started'), ...NODE_STACK.map((l) => line(l, 'stderr')), line('GET /health 200')]);
    expect(merged).toHaveLength(3);
    expect(merged[1]?.lineCount).toBe(4);
    expect(merged[1]?.text.split('\n')[0]).toContain('TypeError');
    expect(merged[2]?.text).toBe('GET /health 200');
  });

  it('a Python traceback becomes one record ending at the exception line', () => {
    const merged = mergeMultiline([...PY_TRACE.map((l) => line(l, 'stderr')), line('Booting worker with pid: 9', 'stderr')]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.lineCount).toBe(6);
    expect(merged[0]?.text.endsWith("KeyError: 'DATABASE_URL'")).toBe(true);
    expect(merged[1]?.text).toBe('Booting worker with pid: 9');
  });

  it('does not merge across streams', () => {
    const merged = mergeMultiline([line('Error: x', 'stderr'), line('    at f (/app/a.js:1:1)', 'stdout')]);
    expect(merged).toHaveLength(2);
  });
});

describe('detectLevel', () => {
  it.each([
    ['{"level":50,"msg":"db down"}', 'error'],
    ['{"level":40,"msg":"slow"}', 'warn'],
    ['{"level":"info","msg":"ok"}', 'info'],
    ['{"severity":"ERROR","message":"x"}', 'error'],
    ['ERROR: something broke', 'error'],
    ["TypeError: Cannot read properties of undefined (reading 'id')", 'error'],
    ['Traceback (most recent call last):', 'error'],
    ['(node:1) UnhandledPromiseRejectionWarning: boom', 'error'],
    ['FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', 'error'],
    ['npm ERR! missing script: start', 'error'],
    ['(node:12) Warning: Possible EventEmitter memory leak detected', 'warn'],
    ['WARNING: slow query', 'warn'],
    ['GET /api/items 200 3ms', 'info'],
  ])('%s → %s', (text, level) => {
    expect(detectLevel(text)).toBe(level);
  });
});

describe('collectLogs', () => {
  it('sorts, merges, levels, keeps stream and redacts', async () => {
    const lines = [
      line('listening on 3000'),
      ...NODE_STACK.map((l) => line(l, 'stderr')),
      line('connecting to postgres://admin:hunter2pw@db:5432/app', 'stderr'),
    ].reverse();
    const recs = await collectLogs(source(lines), 'shop');
    expect(recs.map((r) => [r.level, r.stream, r.lineCount])).toEqual([
      ['info', 'stdout', 1],
      ['error', 'stderr', 4],
      ['info', 'stderr', 1],
    ]);
    expect(recs[2]?.text).toBe('connecting to postgres://admin:***@db:5432/app');
    expect(JSON.stringify(recs)).not.toContain('hunter2pw');
  });

  it('max keeps the newest records', async () => {
    const recs = await collectLogs(source([line('a'), line('b'), line('c')]), 'shop', { max: 2 });
    expect(recs.map((r) => r.text)).toEqual(['b', 'c']);
  });

  it('passes the window to the source', async () => {
    let seen: unknown;
    await collectLogs({ getLogs: async (_n, o) => ((seen = o), []) }, 'shop', { windowSec: 900 });
    expect(seen).toEqual({ windowSec: 900 });
  });
});
