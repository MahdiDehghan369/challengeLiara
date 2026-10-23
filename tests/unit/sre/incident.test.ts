import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ScriptedApprover, guard } from '../../../src/safety/approval.js';
import { AuditLog } from '../../../src/safety/audit.js';
import { Risk } from '../../../src/safety/risk.js';
import type { Signal } from '../../../src/sre/detectors/types.js';
import { actionsFromAudit, createIncident, renderIncident, writeIncidentReport, type Incident } from '../../../src/sre/incident.js';
import type { Hypothesis } from '../../../src/sre/rca.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-incident-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const NOW = new Date('2026-10-23T12:30:00Z');

const signals: Signal[] = [
  { id: 'app-down', severity: 'critical', titleFa: 'اپ از دسترس خارج است', evidence: { probe: { availability: 0 } } },
  {
    id: 'missing-env',
    severity: 'critical',
    titleFa: 'یک متغیر محیطی لازم تنظیم نشده',
    evidence: { logRefs: [{ ts: Date.parse('2026-10-23T12:00:05Z'), snippet: 'TypeError [ERR_INVALID_URL]: Invalid URL' }] },
    detail: 'DATABASE_URL',
  },
];
const hypotheses: Hypothesis[] = [
  {
    id: 'h1',
    titleFa: 'یک متغیر محیطی لازم تنظیم نشده: DATABASE_URL',
    category: 'config',
    confidence: 0.8,
    evidence: [{ type: 'log', ref: 'log:1', quote: 'TypeError [ERR_INVALID_URL]: Invalid URL' }],
    explanationFa: 'برنامه هنگام شروع به یک متغیر محیطی نیاز دارد که روی لیارا تنظیم نشده است.',
    proposedFixes: [{ actionType: 'set_env', params: { name: 'DATABASE_URL' }, expectedEffectFa: 'x' }],
    howToVerifyFa: 'y',
    source: 'rules',
    signalIds: ['missing-env'],
  },
];

function incident(): Incident {
  const i = createIncident({ app: 'shop', kind: 'runtime', signals, hypotheses, now: new Date('2026-10-23T12:00:00Z'), id: 'inc-20261023-120000-abcd', timeline: [{ ts: Date.parse('2026-10-23T11:55:00Z'), kind: 'deploy', text: 'deploy v7 (cli) result=success' }] });
  i.actions = [{ ts: '2026-10-23T12:10:00.000Z', tool: 'set_env', risk: 'R2', result: 'ok', decision: 'approved' }];
  i.verification = {
    verdict: 'resolved',
    verdictFa: 'رفع شد',
    table: [
      { key: 'availability', labelFa: 'دسترس‌پذیری (٪)', before: '0', after: '100', better: true },
      { key: 'critical', labelFa: 'هشدارهای بحرانی', before: '2', after: '0', better: true },
    ],
  };
  i.status = 'resolved';
  i.closedAt = '2026-10-23T12:12:00.000Z';
  return i;
}

describe('incident report', () => {
  it('createIncident: id, severity from signals, open', () => {
    const i = createIncident({ app: 'shop', kind: 'runtime', signals, now: NOW });
    expect(i.id).toMatch(/^inc-20261023-123000-[0-9a-f]{4}$/);
    expect(i).toMatchObject({ severity: 'critical', status: 'open', openedAt: NOW.toISOString(), actions: [] });
  });

  it('markdown has the fixed Persian sections in order (snapshot)', () => {
    const { markdown } = renderIncident(incident(), NOW);
    const order = ['## خلاصه', '## اثر', '## خط زمانی', '## علت ریشه‌ای', '## شواهد', '## اقدامات', '## نتیجهٔ راستی‌آزمایی', '## پیشگیری در آینده'];
    const positions = order.map((h) => markdown.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown).toMatchSnapshot();
  });

  it('HTML is a single RTL file without external resources (snapshot)', () => {
    const { html } = renderIncident(incident(), NOW);
    expect(html).toContain('<html lang="fa" dir="rtl">');
    expect(html).not.toMatch(/<(script|link)\b|src=|href=/);
    expect(html).toContain('<td>دسترس‌پذیری (٪)</td>');
    expect(html).toMatchSnapshot();
  });

  it('acceptance: no secret survives into the report', () => {
    const i = incident();
    i.summaryFa = 'اتصال با postgres://admin:hunter2-secret@db.internal:5432/app شکست خورد';
    i.hypotheses[0]!.evidence.push({ type: 'log', ref: 'log:2', quote: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl' });
    i.signals[1]!.evidence.logRefs!.push({ ts: 1, snippet: 'api_key=sk-live-abcdefghijklmnopqrstuvwxyz123456' });
    const { markdown, html } = renderIncident(i, NOW);
    for (const out of [markdown, html]) {
      expect(out).not.toContain('hunter2-secret');
      expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ');
      expect(out).not.toContain('sk-live-abcdefghijklmnopqrstuvwxyz123456');
    }
  });

  it('actions come from the audit log; files are written under reports/incidents', async () => {
    const dataDir = join(root, 'data');
    const audit = new AuditLog(dataDir);
    await guard(
      { id: 'p1', toolName: 'restart_app', titleFa: 't', reasonFa: 'r', target: { app: 'shop' }, risk: Risk.R1, impactFa: 'i', rollbackFa: 'b', command: 'c', params: { app: 'shop' } },
      new ScriptedApprover(['approved']),
      async () => true,
      { audit },
    );
    const i = incident();
    i.actions = actionsFromAudit(dataDir, 'shop', '2026-01-01T00:00:00Z');
    expect(i.actions.map((a) => [a.tool, a.risk, a.result])).toEqual([['restart_app', 'R1', 'ok']]);
    const files = writeIncidentReport(join(root, 'reports'), i, NOW);
    expect(files.markdown).toMatch(/reports[\\/]incidents[\\/]inc-20261023-120000-abcd\.md$/);
    expect(existsSync(files.html)).toBe(true);
    expect(readFileSync(files.markdown, 'utf8')).toContain('restart_app');
  });
});
