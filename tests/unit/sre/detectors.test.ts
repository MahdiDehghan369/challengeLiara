import { describe, expect, it } from 'vitest';
import type { AppEvent, DeploymentRecord } from '../../../src/liara/index.js';
import type { DiskWithUsage } from '../../../src/ops/backups.js';
import { DETECTORS, runDetectors, type Detector } from '../../../src/sre/detectors/index.js';
import type { ProbeResult } from '../../../src/sre/health.js';
import { detectLevel, type LogRecord } from '../../../src/sre/logs.js';
import { analyzeSeries, type MetricAnalysis } from '../../../src/sre/metrics.js';
import type { Snapshot } from '../../../src/sre/snapshot.js';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const MIN = 60_000;
const ok = <T>(value: T) => ({ ok: true as const, value, ms: 1 });
const failed = { ok: false as const, errorFa: 'x', code: 'ERROR', ms: 1 };

const log = (text: string, minutesAgo = 1): LogRecord => ({ ts: NOW - minutesAgo * MIN, stream: 'stdout', level: detectLevel(text), text, lineCount: text.split('\n').length });
const event = (message: string, kind: AppEvent['kind'], minutesAgo = 1): AppEvent => ({ ts: NOW - minutesAgo * MIN, kind, message, meta: {}, raw: [] });

function probeResult(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    url: 'https://shop.liara.run',
    total: 4,
    availability: 100,
    p50: 40,
    p95: 80,
    errorRate: 0,
    statusHistogram: { '200': 4 },
    errorHistogram: { timeout: 0, dns: 0, tls: 0, connection: 0, other: 0 },
    tlsValid: true,
    samples: [],
    ...over,
  };
}

function metric(kind: 'cpu' | 'memory', values: number[], unit: 'percent' | 'unknown' = 'percent'): MetricAnalysis {
  return analyzeSeries({ kind, unit, series: [{ applet: 'shop-1', points: values.map((value, i) => ({ ts: NOW - (values.length - i) * MIN, value })) }], dropped: 0, end: undefined });
}

/** A healthy app; tests override single sources. */
function snap(over: Partial<Snapshot['sources']> = {}): Snapshot {
  return {
    app: 'shop',
    takenAt: new Date(NOW).toISOString(),
    windowSec: 3600,
    sources: {
      app: ok({ name: 'shop', status: 'ACTIVE', scale: 1, planID: 'small-g2', platform: 'node', isDeployed: true }),
      plan: ok(undefined),
      lastDeploy: ok(undefined),
      events: ok([event('App started with the new release', 'restart', 50)]),
      metrics: ok({ cpu: metric('cpu', [10, 12, 11, 9, 12, 10]), memory: metric('memory', [40, 41, 40, 42, 41, 40]) }),
      logs: ok([log('shop listening on port 3000', 50), log('GET / 200 3ms', 10)]),
      probe: ok(probeResult()),
      disks: ok([]),
      envChanges: ok([]),
      ...over,
    },
    partial: false,
    failed: [],
  };
}

const ids = (d: Detector, s: Snapshot) => d(s).map((x) => x.id);
const deploy = (minutesAgo: number): DeploymentRecord => ({ id: 'd1', app: 'shop', mode: 'cli', version: 'v7', gitDirty: false, startedAt: new Date(NOW - minutesAgo * MIN).toISOString(), result: 'success' });
const disk = (usagePercent: number): DiskWithUsage => ({ name: 'data', size: 1, usagePercent, warningFa: undefined }) as unknown as DiskWithUsage;

describe('detectors: a healthy snapshot fires nothing', () => {
  it('runDetectors(healthy) → []', () => {
    expect(runDetectors(snap())).toEqual([]);
  });
  it('a failed source never triggers a detector', () => {
    expect(runDetectors(snap({ logs: failed, probe: failed, events: failed, metrics: failed, disks: failed }))).toEqual([]);
  });
});

// [detector, positive snapshot, negative snapshot]
const CASES: Array<[string, () => Snapshot, () => Snapshot]> = [
  ['app-down', () => snap({ probe: ok(probeResult({ availability: 0, statusHistogram: { '502': 4 } })) }), () => snap({ probe: ok(probeResult({ availability: 75, statusHistogram: { '200': 3, '502': 1 } })) })],
  [
    'crash-loop',
    () => snap({ events: ok([event('Back-off restarting failed container', 'crash', 5), event('Back-off restarting failed container', 'crash', 2)]) }),
    () => snap({ events: ok([event('Back-off restarting failed container', 'crash', 5)]) }),
  ],
  ['oom', () => snap({ logs: ok([log('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory')]) }), () => snap({ logs: ok([log('GC took 12ms')]) })],
  [
    'memory-leak-trend',
    () => snap({ metrics: ok({ cpu: metric('cpu', [10, 10, 10]), memory: metric('memory', [30, 33, 36, 39, 42, 45, 48, 51]) }) }),
    () => snap({ metrics: ok({ cpu: metric('cpu', [10, 10, 10]), memory: metric('memory', [40, 38, 41, 39, 42, 40, 41, 39]) }) }),
  ],
  [
    'cpu-saturation',
    () => snap({ metrics: ok({ cpu: metric('cpu', [92, 95, 97, 96, 94, 98]), memory: metric('memory', [40, 40, 40]) }) }),
    () => snap({ metrics: ok({ cpu: metric('cpu', [92, 95, 97, 96, 94, 98], 'unknown'), memory: metric('memory', [40, 40, 40]) }) }),
  ],
  ['http-5xx-rate', () => snap({ probe: ok(probeResult({ availability: 50, statusHistogram: { '200': 2, '500': 2 } })) }), () => snap({ probe: ok(probeResult({ statusHistogram: { '200': 3, '404': 1 } })) })],
  ['slow-response', () => snap({ probe: ok(probeResult({ p95: 2400 })) }), () => snap({ probe: ok(probeResult({ p95: 900 })) })],
  ['missing-env', () => snap({ logs: ok([log("KeyError: 'SECRET_KEY'")]) }), () => snap({ logs: ok([log('config loaded: DATABASE_URL is set')]) })],
  ['port-mismatch', () => snap({ logs: ok([log('Error: listen EADDRINUSE: address already in use :::3000')]) }), () => snap({ logs: ok([log('listening on 0.0.0.0:3000')]) })],
  ['db-connection', () => snap({ logs: ok([log('error: password authentication failed for user "app"')]) }), () => snap({ logs: ok([log('connected to database')]) })],
  ['module-not-found', () => snap({ logs: ok([log("Error: Cannot find module 'express'\nRequire stack:\n- /app/index.js")]) }), () => snap({ logs: ok([log('loaded module express')]) })],
  [
    'unhandled-exception',
    () => snap({ logs: ok([log("TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (/app/src/orders.js:14:29)\n    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)")]) }),
    () => snap({ logs: ok([log("TypeError: x is not a function\n    at f (/app/node_modules/lib/index.js:1:1)\n    at node:internal/process:1:1")]) }),
  ],
  ['disk-full', () => snap({ disks: ok([disk(97)]) }), () => snap({ disks: ok([disk(40)]) })],
  [
    'release-regression',
    () => snap({ lastDeploy: ok(deploy(20)), logs: ok([log('GET / 200', 40), log('Error: boom after release', 10)]) }),
    () => snap({ lastDeploy: ok(deploy(20)), logs: ok([log('Error: boom before release', 40), log('Error: boom after release', 10)]) }),
  ],
  ['tls-issue', () => snap({ probe: ok(probeResult({ tlsValid: false, errorHistogram: { timeout: 0, dns: 0, tls: 4, connection: 0, other: 0 } })) }), () => snap()],
  ['read-only-fs', () => snap({ logs: ok([log("Error: EROFS: read-only file system, open '/app/uploads/a.png'")]) }), () => snap({ logs: ok([log('saved /app/uploads/a.png')]) })],
];

describe('detectors: positive and negative per detector (acceptance)', () => {
  it('covers all 16 detectors', () => {
    expect(CASES.map((c) => c[0]).sort()).toEqual(Object.keys(DETECTORS).sort());
  });
  it.each(CASES)('%s', (id, positive, negative) => {
    const d = DETECTORS[id]!;
    expect(ids(d, positive())).toEqual([id]);
    expect(ids(d, negative())).toEqual([]);
  });
});

describe('detector details', () => {
  it('missing-env names the variable; module-not-found the module; disk-full escalates at 98%', () => {
    expect(DETECTORS['missing-env']!(snap({ logs: ok([log("KeyError: 'SECRET_KEY'")]) }))[0]?.detail).toBe('SECRET_KEY');
    expect(DETECTORS['module-not-found']!(snap({ logs: ok([log("Error: Cannot find module './config'")]) }))[0]?.detail).toBe('./config');
    expect(DETECTORS['disk-full']!(snap({ disks: ok([disk(99)]) }))[0]?.severity).toBe('critical');
    expect(DETECTORS['disk-full']!(snap({ logs: ok([log("Error: ENOSPC: no space left on device, write '/app/data/x'")]) }))[0]?.severity).toBe('critical');
  });

  it('stopped app (scale 0) is app-down; unhandled-exception points at the user file', () => {
    expect(DETECTORS['app-down']!(snap({ app: ok({ name: 'shop', status: 'STOPPED', scale: 0, planID: 'p', platform: 'node', isDeployed: true }) }))[0]?.detail).toBe('scale=0');
    const s = snap({ logs: ok([log("TypeError: boom\n    at handler (/app/src/orders.js:14:29)")]) });
    expect(DETECTORS['unhandled-exception']!(s)[0]?.detail).toBe('/app/src/orders.js:14');
  });

  it('runDetectors sorts critical first and survives a throwing detector', () => {
    const s = snap({
      probe: ok(probeResult({ p95: 2400 })),
      logs: ok([log('error: password authentication failed for user "app"')]),
    });
    const out = runDetectors(s, {
      ...DETECTORS,
      broken: () => {
        throw new Error('bug');
      },
    });
    expect(out.map((x) => x.severity)).toEqual(['critical', 'warn']);
    expect(out[0]?.titleFa).toMatch(/[؀-ۿ]/);
  });
});
