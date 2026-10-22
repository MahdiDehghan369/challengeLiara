import { appendFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DeploymentLedger } from '../../../src/liara/ledger.js';

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'siavash-data-'));
  const projectDir = mkdtempSync(join(tmpdir(), 'siavash-proj-'));
  let t = Date.parse('2026-10-20T10:00:00.000Z');
  const corrupt: Array<{ line: number; reason: string }> = [];
  const ledger = new DeploymentLedger({
    dataDir,
    projectDir,
    now: () => new Date((t += 60_000)),
    onCorruptLine: (i) => corrupt.push({ line: i.line, reason: i.reason }),
  });
  return { ledger, dataDir, projectDir, corrupt };
}

const base = { app: 'shop-api', mode: 'api' as const, port: 3000, platform: 'node' };

describe('DeploymentLedger', () => {
  it('records to the data dir and the project copy (append-only)', () => {
    const { ledger, dataDir, projectDir } = setup();
    const r = ledger.record({ ...base, sourceID: 's1', releaseID: 'r1', gitCommit: 'abc1234', archiveSha256: 'f'.repeat(64) });
    expect(r.result).toBe('pending');
    expect(r.gitDirty).toBe(false);
    ledger.update('shop-api', r.id, { result: 'success', healthAfter: { score: 95, verdict: 'healthy' } });
    const main = join(dataDir, 'ledger', 'shop-api.jsonl');
    const copy = join(projectDir, '.siavash', 'deployments.jsonl');
    expect(existsSync(main)).toBe(true);
    expect(readFileSync(main, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(readFileSync(copy, 'utf8')).toBe(readFileSync(main, 'utf8'));
  });

  it('list returns the latest snapshot per id; update sets finishedAt', () => {
    const { ledger } = setup();
    const a = ledger.record(base);
    const b = ledger.record({ ...base, mode: 'cli', version: 'v2' });
    ledger.update('shop-api', a.id, { result: 'failed' });
    const all = ledger.list('shop-api');
    expect(all.map((r) => [r.id, r.result])).toEqual([
      [a.id, 'failed'],
      [b.id, 'pending'],
    ]);
    expect(all[0]?.finishedAt).toBeDefined();
    expect(ledger.latest('shop-api')?.id).toBe(b.id);
  });

  it('update of an unknown id throws', () => {
    const { ledger } = setup();
    expect(() => ledger.update('shop-api', 'nope', { result: 'success' })).toThrow(/unknown deployment/);
  });

  it('skips and reports corrupt lines', () => {
    const { ledger, dataDir, corrupt } = setup();
    const a = ledger.record(base);
    const file = join(dataDir, 'ledger', 'shop-api.jsonl');
    appendFileSync(file, '{not json\n');
    appendFileSync(file, '{"id":"x","app":"shop-api"}\n');
    const b = ledger.record(base);
    expect(ledger.list('shop-api').map((r) => r.id)).toEqual([a.id, b.id]);
    expect(corrupt.map((c) => c.line)).toEqual([2, 3]);
  });

  it('previousHealthy finds the last success before the latest (or a given id)', () => {
    const { ledger } = setup();
    const ok1 = ledger.record({ ...base, result: 'success', sourceID: 's1' });
    ledger.record({ ...base, result: 'failed', sourceID: 's2' });
    const ok3 = ledger.record({ ...base, result: 'success', sourceID: 's3' });
    const bad4 = ledger.record({ ...base, result: 'success', sourceID: 's4' });
    expect(ledger.previousHealthy('shop-api')?.id).toBe(ok3.id);
    expect(ledger.previousHealthy('shop-api', ok3.id)?.id).toBe(ok1.id);
    expect(ledger.previousHealthy('shop-api', ok1.id)).toBeUndefined();
    expect(bad4.sourceID).toBe('s4');
  });

  it('findByCommit matches full and short hashes', () => {
    const { ledger } = setup();
    ledger.record({ ...base, gitCommit: 'abcdef1234567890' });
    ledger.record({ ...base, gitCommit: '0123456789abcdef' });
    expect(ledger.findByCommit('shop-api', 'abcdef1')).toHaveLength(1);
    expect(ledger.findByCommit('shop-api', '0123456789abcdef')).toHaveLength(1);
    expect(ledger.findByCommit('shop-api', 'ffff')).toHaveLength(0);
  });

  it('separate files per app; unknown app → empty', () => {
    const { ledger } = setup();
    ledger.record(base);
    ledger.record({ ...base, app: 'other' });
    expect(ledger.list('shop-api')).toHaveLength(1);
    expect(ledger.list('other')).toHaveLength(1);
    expect(ledger.list('missing')).toEqual([]);
    expect(ledger.latest('missing')).toBeUndefined();
  });
});
