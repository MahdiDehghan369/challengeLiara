import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient } from '../../../src/liara/index.js';
import { ScriptedApprover } from '../../../src/safety/approval.js';
import type { Signal } from '../../../src/sre/detectors/index.js';
import { healthScore } from '../../../src/sre/health-score.js';
import { sreTools, ToolRegistry, type HealthCheckResult } from '../../../src/tools/index.js';

const sig = (id: string, severity: Signal['severity']): Signal => ({ id, severity, titleFa: `عنوان ${id}`, evidence: {} });

describe('healthScore', () => {
  it('no signals → 100, healthy, Persian sentence', () => {
    expect(healthScore('shop', [])).toMatchObject({ score: 100, label: 'healthy', labelFa: 'سالم', counts: { critical: 0, warn: 0, info: 0 } });
    expect(healthScore('shop', []).summaryFa).toContain('shop');
  });

  it('acceptance: any critical signal takes the score below 50', () => {
    for (const extra of [[], [sig('a', 'info')], [sig('a', 'warn'), sig('b', 'info')]]) {
      const r = healthScore('shop', [sig('app-down', 'critical'), ...extra]);
      expect(r.score).toBeLessThan(50);
      expect(r.label).toBe('critical');
    }
  });

  it('warnings → needs attention; many warnings can reach critical; never below 0', () => {
    expect(healthScore('shop', [sig('slow-response', 'warn')])).toMatchObject({ score: 88, label: 'attention', labelFa: 'نیاز به توجه' });
    expect(healthScore('shop', Array.from({ length: 5 }, (_, i) => sig(`w${i}`, 'warn'))).label).toBe('critical');
    expect(healthScore('shop', Array.from({ length: 12 }, (_, i) => sig(`c${i}`, 'critical'))).score).toBe(0);
    expect(healthScore('shop', [sig('i', 'info')]).label).toBe('healthy');
  });

  it('summary names the most severe problem and notes missing sources', () => {
    const r = healthScore('shop', [sig('slow-response', 'warn'), sig('db-connection', 'critical')], { failedSources: ['metrics'] });
    expect(r.summaryFa).toContain('عنوان db-connection');
    expect(r.summaryFa).toContain('metrics');
  });
});

describe('health_check tool (mock, R0)', () => {
  const root = mkdtempSync(join(tmpdir(), 'siavash-health-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let open: LiaraClient[] = [];
  afterEach(async () => {
    await Promise.all(open.map((c) => c.mock!.servers.close()));
    open = [];
  });
  const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });

  it('healthy app → high score; missing-env app → critical with the right signals; no approval asked', async () => {
    const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });
    open.push(liara);
    const mock = liara.mock!.state;
    const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
    mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
    await mock.settle();

    const registry = new ToolRegistry();
    for (const t of sreTools({ urlFor: (n) => liara.mock!.servers.urlFor(n), probe: { count: 1, timeoutMs: 5000, fetchImpl: noKeepAlive } })) registry.register(t);
    const approver = new ScriptedApprover([]);

    const healthy = await registry.invoke('health_check', { app: 'shop' }, { liara, approver });
    expect(healthy.ok).toBe(true);
    const h = healthy.ok ? (healthy.result as HealthCheckResult) : undefined;
    expect(h?.label).toBe('healthy');
    expect(h?.score).toBeGreaterThanOrEqual(80);

    mock.injectScenario('shop', 'missing-env');
    const sick = await registry.invoke('health_check', { app: 'shop' }, { liara, approver });
    const s = sick.ok ? (sick.result as HealthCheckResult) : undefined;
    expect(s?.label).toBe('critical');
    expect(s?.score).toBeLessThan(50);
    expect(s?.signals.map((x) => x.id)).toEqual(expect.arrayContaining(['app-down', 'missing-env']));
    expect(sick.ok && sick.forLlm).toContain('missing-env');
    expect(approver.seen).toEqual([]);
  });
});
