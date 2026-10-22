import { describe, expect, it } from 'vitest';
import { clusterLogs, errorSignature, normalizeMessage, parseFrames } from '../../../src/sre/log-cluster.js';
import type { LogRecord } from '../../../src/sre/logs.js';

const rec = (ts: number, text: string, level: LogRecord['level'] = 'error'): LogRecord => ({
  ts,
  stream: 'stderr',
  level,
  text,
  lineCount: text.split('\n').length,
});

const nodeErr = (id: number) =>
  [
    `TypeError: Cannot read properties of undefined (reading 'total') for order ${id}`,
    `    at calcTotal (/app/src/services/orders.js:${40 + (id % 3)}:17)`,
    '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
  ].join('\n');

const dbErr = (port: number) => `Error: connect ECONNREFUSED 10.0.${port % 250}.7:5432`;

const pyErr = (key: string) =>
  [
    'Traceback (most recent call last):',
    '  File "/usr/local/lib/python3.12/site-packages/django/core/handlers/base.py", line 197, in _get_response',
    '  File "/app/shop/views.py", line 31, in checkout',
    `KeyError: '${key}'`,
  ].join('\n');

describe('clusterLogs', () => {
  it('1000 log lines with 3 recurring errors → 3 clusters', () => {
    const records: LogRecord[] = [];
    let t = 1_760_000_000_000;
    for (let i = 0; i < 1000; i++) {
      t += 1000;
      if (i % 10 === 0) records.push(rec(t, nodeErr(i)));
      else if (i % 10 === 1) records.push(rec(t, dbErr(i)));
      else if (i % 25 === 2) records.push(rec(t, pyErr('STRIPE_KEY')));
      else records.push(rec(t, `GET /api/items/${i} 200 ${i % 50}ms`, 'info'));
    }
    const clusters = clusterLogs(records);
    expect(clusters).toHaveLength(3);
    expect(clusters.map((c) => c.count)).toEqual([100, 100, 40]);
    expect(clusters.reduce((s, c) => s + c.count, 0)).toBe(240);
    const node = clusters.find((c) => c.sample.startsWith('TypeError'));
    expect(node?.isUserCode).toBe(true);
    expect(node?.topFrames[0]).toMatchObject({ file: '/app/src/services/orders.js', fn: 'calcTotal', isUserCode: true });
    expect(node?.firstSeen).toBeLessThan(node?.lastSeen as number);
  });

  it('sorts by count, then recency', () => {
    const c = clusterLogs([rec(1, 'Error: a'), rec(2, 'Error: b'), rec(3, 'Error: b'), rec(4, 'Error: c')]);
    expect(c.map((x) => x.sample)).toEqual(['Error: b', 'Error: c', 'Error: a']);
  });

  it('ignores non-error levels by default; levels option widens', () => {
    const records = [rec(1, 'WARNING: slow', 'warn'), rec(2, 'Error: x')];
    expect(clusterLogs(records)).toHaveLength(1);
    expect(clusterLogs(records, { levels: ['error', 'warn'] })).toHaveLength(2);
  });
});

describe('signatures', () => {
  it('normalizeMessage strips ids, numbers, timestamps, IPs and paths', () => {
    expect(normalizeMessage('2026-10-20T12:00:00Z user 42 at 10.0.0.7:5432 req 3f2a9c1b7e4d5a6b /app/src/x.js')).toBe(
      '<ts> user <n> at <ip> req <hex> <path>',
    );
    expect(normalizeMessage('id 0b9d6a2e-1c3f-4e5a-9b7c-2d1e0f3a4b5c')).toBe('id <uuid>');
  });

  it('same error with different line numbers / ids shares a signature; different errors do not', () => {
    expect(errorSignature(nodeErr(1))).toBe(errorSignature(nodeErr(2)));
    expect(errorSignature(dbErr(1))).toBe(errorSignature(dbErr(99)));
    expect(errorSignature(nodeErr(1))).not.toBe(errorSignature(dbErr(1)));
    expect(errorSignature(pyErr('A'))).toContain("KeyError: 'A'");
  });

  it('parseFrames: node + python; python innermost first; user code flag', () => {
    const n = parseFrames(nodeErr(1));
    expect(n.map((f) => f.isUserCode)).toEqual([true, false]);
    const p = parseFrames(pyErr('X'));
    expect(p[0]).toMatchObject({ file: '/app/shop/views.py', line: 31, fn: 'checkout', isUserCode: true });
    expect(p[1]?.isUserCode).toBe(false);
    expect(parseFrames('    at node:internal/process/task_queues:95:5')[0]?.isUserCode).toBe(false);
  });
});
