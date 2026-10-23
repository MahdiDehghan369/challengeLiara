import { describe, expect, it } from 'vitest';
import { MockLlm, type ChatRequest } from '../../../src/llm/index.js';
import { analyzeBuildLog, analyzeLogs } from '../../../src/sre/log-analyzer.js';
import { detectLevel, type LogRecord } from '../../../src/sre/logs.js';

let t = Date.parse('2026-10-23T10:00:00Z');
const rec = (text: string): LogRecord => ({ ts: (t += 1000), stream: 'stderr', level: detectLevel(text), text, lineCount: text.split('\n').length });

/** Two known errors (×3 and ×1), one unknown error (×2), plus noise. */
function records(): LogRecord[] {
  return [
    rec('GET / 200 3ms'),
    rec("Error: Cannot find module 'express'\nRequire stack:\n- /app/index.js"),
    rec("Error: Cannot find module 'express'\nRequire stack:\n- /app/index.js"),
    rec("Error: Cannot find module 'express'\nRequire stack:\n- /app/index.js"),
    rec('Error: connect ECONNREFUSED 127.0.0.1:5432'),
    rec('Error: invoice total mismatch for order 1842 (expected 120, got 95)\n    at reconcile (/app/src/billing.js:88:11)'),
    rec('Error: invoice total mismatch for order 1907 (expected 300, got 280)\n    at reconcile (/app/src/billing.js:88:11)'),
    rec('INFO done'),
  ];
}

const sent = (llm: MockLlm) => (llm.calls[0] as ChatRequest).messages.map((m) => m.content ?? '').join('\n');

describe('analyzeLogs', () => {
  it('acceptance: without an LLM only knowledge-base findings are returned', async () => {
    const r = await analyzeLogs(records());
    expect(r.llm).toEqual({ used: false });
    expect(r.clusters).toBe(3);
    expect(r.unexplained).toBe(1);
    expect(r.findings.map((f) => [f.kbMatch?.id, f.count, f.severity, f.source])).toEqual([
      [expect.stringMatching(/module/), 3, 'critical', 'kb'],
      ['db-econnrefused-localhost-postgres', 1, 'warn', 'kb'],
    ]);
    expect(r.findings[0]?.interpretationFa).toMatch(/[؀-ۿ]/);
    expect(r.findings[0]?.kbMatch?.fixes.length).toBeGreaterThan(0);
  });

  it('LLM interprets only the unmatched clusters, inside <data>; unknown ids are ignored', async () => {
    const llm = new MockLlm().on(() => true, {
      content: JSON.stringify({
        findings: [
          { id: 'c1', interpretationFa: 'محاسبهٔ مبلغ فاکتور اشتباه است.', category: 'code', severity: 'warn' },
          { id: 'c9', interpretationFa: 'ساختگی', category: 'code', severity: 'critical' },
          { id: 'c1', interpretationFa: 'تکراری', category: 'code', severity: 'critical' },
        ],
      }),
    });
    const r = await analyzeLogs(records(), { llm, platform: 'node' });
    expect(r.llm.used).toBe(true);
    expect(r.unexplained).toBe(0);
    const fromLlm = r.findings.filter((f) => f.source === 'llm');
    expect(fromLlm).toHaveLength(1);
    expect(fromLlm[0]).toMatchObject({ count: 2, category: 'code', severity: 'warn', interpretationFa: 'محاسبهٔ مبلغ فاکتور اشتباه است.' });
    const text = sent(llm);
    expect(text).toContain('<data source="log-clusters">');
    expect(text).toContain('invoice total mismatch');
    // known clusters are not sent to the LLM
    expect(text).not.toContain('Cannot find module');
    expect(llm.calls[0]?.role).toBe('cheap');
  });

  it('caps the LLM input at the top 20 clusters and redacts secrets', async () => {
    const many = Array.from({ length: 30 }, (_, i) => rec(`Error: custom failure kind${String.fromCharCode(65 + (i % 26))}${i} token=sk-live-abcdefghijklmnopqrstu${i}`));
    const llm = new MockLlm().on(() => true, { content: '{"findings":[]}' });
    await analyzeLogs(many, { llm });
    const text = sent(llm);
    expect((text.match(/^c\d+ \(count=/gm) ?? []).length).toBe(20);
    expect(text).not.toContain('sk-live-abcdefghijklmnopqrstu');
  });

  it('LLM failure degrades to knowledge-base findings with a Persian note', async () => {
    const llm = new MockLlm().on(() => true, { content: 'not json' });
    const r = await analyzeLogs(records(), { llm });
    expect(r.llm.used).toBe(false);
    expect(r.llm.errorFa).toBeTruthy();
    expect(r.findings.every((f) => f.source === 'kb')).toBe(true);
  });

  it('no unmatched clusters → the LLM is not called', async () => {
    const llm = new MockLlm().on(() => true, { content: '{"findings":[]}' });
    await analyzeLogs([rec('Error: connect ECONNREFUSED 127.0.0.1:5432')], { llm });
    expect(llm.calls).toHaveLength(0);
  });

  it('build logs go through the same analysis', async () => {
    const r = await analyzeBuildLog(['Step 1/3 : RUN npm ci', 'npm ERR! code ERESOLVE', 'npm ERR! ERESOLVE unable to resolve dependency tree', "Error: Cannot find module 'typescript'"]);
    expect(r.clusters).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.source === 'kb')).toBe(true);
  });
});
