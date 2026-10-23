import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLiaraClient } from '../../../src/liara/index.js';
import { ScriptedApprover } from '../../../src/safety/approval.js';
import { Risk } from '../../../src/safety/risk.js';
import { ValidationError } from '../../../src/shared/errors.js';
import { applyProbeResults, buildProbeCommand, runContainerChecks } from '../../../src/sre/container-probes.js';
import type { Hypothesis, RcaResult } from '../../../src/sre/rca.js';
import { sreTools, ToolRegistry } from '../../../src/tools/index.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-probes-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function world() {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(root, 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  const app = liara.mock!.state.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  liara.mock!.state.updateEnvs(app, [{ key: 'JWT_SECRET', value: 'very-secret-value-123456' }]);
  return { liara };
}

describe('allowlist (acceptance: anything else is rejected)', () => {
  it('builds only the predefined read-only commands', () => {
    expect(buildProbeCommand({ id: 'env-names' })).toBe('env | cut -d= -f1');
    expect(buildProbeCommand({ id: 'tcp', args: { host: 'shop-db.internal', port: 5432 } })).toBe('nc -zv -w 3 shop-db.internal 5432');
    expect(buildProbeCommand({ id: 'list-dir', args: { path: '/app/uploads' } })).toBe('ls -la /app/uploads');
  });

  it.each([
    [{ id: 'rm', args: {} }],
    [{ id: 'shell', args: { path: 'cat /etc/passwd' } }],
    [{ id: 'dns', args: { host: 'x; rm -rf /' } }],
    [{ id: 'dns', args: { host: '$(curl evil)' } }],
    [{ id: 'tcp', args: { host: 'db', port: 0 } }],
    [{ id: 'tcp', args: { host: 'db' } }],
    [{ id: 'list-dir', args: { path: '../../etc' } }],
    [{ id: 'list-dir', args: { path: '/app && reboot' } }],
  ])('rejects %j', (check) => {
    expect(() => buildProbeCommand(check)).toThrow(ValidationError);
  });

  it('a batch with one bad check runs nothing', async () => {
    const { liara } = world();
    const calls: string[] = [];
    const runner = { runInContainer: async (_a: string, c: string) => (calls.push(c), { stdout: '', exitCode: 0, timedOut: false, via: 'ws' as const }) };
    await expect(runContainerChecks(runner, 'shop', [{ id: 'disk' }, { id: 'curl' }])).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toEqual([]);
    void liara;
  });
});

describe('runContainerChecks (console mock)', () => {
  it('env names only (no values), tcp to localhost fails, internal host succeeds', async () => {
    const { liara } = world();
    const r = await runContainerChecks(liara.console, 'shop', [
      { id: 'env-names' },
      { id: 'tcp', args: { host: '127.0.0.1', port: 5432 } },
      { id: 'tcp', args: { host: 'shop-db.internal', port: 5432 } },
      { id: 'memory' },
    ]);
    expect(r.map((x) => [x.id, x.ok])).toEqual([
      ['env-names', true],
      ['tcp', false],
      ['tcp', true],
      ['memory', true],
    ]);
    expect(r[0]?.output.split('\n')).toContain('JWT_SECRET');
    expect(JSON.stringify(r)).not.toContain('very-secret-value-123456');
  });
});

describe('applyProbeResults', () => {
  const hyp = (name: string, confidence: number): Hypothesis => ({
    id: 'h1',
    titleFa: 't',
    category: 'config',
    confidence,
    evidence: [],
    explanationFa: 'e',
    proposedFixes: [{ actionType: 'set_env', params: { name }, expectedEffectFa: '' }],
    howToVerifyFa: '',
    source: 'rules',
  });
  const rca = (hs: Hypothesis[]): RcaResult => ({ hypotheses: hs, catalog: [], llm: { used: false, droppedEvidence: 0, droppedHypotheses: 0 } });

  it('missing env name confirms the hypothesis; present name weakens it; results join the catalog', () => {
    const results = [{ id: 'env-names' as const, command: 'env | cut -d= -f1', ok: true, exitCode: 0, output: 'JWT_SECRET\nPORT' }];
    const r = applyProbeResults(rca([hyp('JWT_SECRET', 0.8), hyp('DATABASE_URL', 0.7)]), results);
    expect(r.hypotheses.map((h) => [h.proposedFixes[0]?.params?.name, h.confidence])).toEqual([
      ['DATABASE_URL', 0.85],
      ['JWT_SECRET', 0.5],
    ]);
    expect(r.catalog[0]?.ref).toBe('container:1');
    expect(r.hypotheses[0]?.evidence[0]?.ref).toBe('container:1');
  });
});

describe('container_check tool (R1)', () => {
  it('one R1 card listing the exact commands; a disallowed check never reaches the approver', async () => {
    const { liara } = world();
    const registry = new ToolRegistry();
    for (const t of sreTools()) registry.register(t);
    const approver = new ScriptedApprover(['approved']);
    const ok = await registry.invoke('container_check', { app: 'shop', checks: [{ id: 'disk' }, { id: 'node-version' }] }, { liara, approver });
    expect(ok.ok).toBe(true);
    expect(approver.seen[0]).toMatchObject({ toolName: 'container_check', risk: Risk.R1 });
    expect(approver.seen[0]?.command).toBe('$ df -h\n$ node -v');

    const bad = await registry.invoke('container_check', { app: 'shop', checks: [{ id: 'exec', args: {} }] }, { liara, approver });
    expect(bad.ok).toBe(false);
    const badHost = await registry.invoke('container_check', { app: 'shop', checks: [{ id: 'dns', args: { host: 'a;reboot' } }] }, { liara, approver });
    expect(badHost.ok).toBe(false);
    expect(approver.seen).toHaveLength(1);
  });
});
