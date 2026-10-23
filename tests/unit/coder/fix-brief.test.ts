import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildFixBrief, copyToClipboard, deliverFixBrief, FIX_BRIEF_SECTIONS, type FixBriefInput } from '../../../src/coder/index.js';
import { createIncident } from '../../../src/sre/incident.js';
import type { Hypothesis } from '../../../src/sre/rca.js';
import { ScriptedUi } from '../../../src/ui/cli/scripted-ui.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'demo-apps', 'node-http500');
const tmp = mkdtempSync(join(tmpdir(), 'siavash-brief-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const DB_VALUE = 'postgres://app:Sup3rS3cret@shop-db.internal:5432/shop';
const HYP: Hypothesis = {
  id: 'h1',
  titleFa: 'order.items برای بعضی سفارش‌ها undefined است',
  category: 'code',
  confidence: 0.85,
  evidence: [],
  explanationFa: 'تابع summarize بدون بررسی items طول آن را می‌خواند.',
  proposedFixes: [{ actionType: 'code_patch', expectedEffectFa: 'x' }],
  howToVerifyFa: 'x',
  source: 'rules',
};
const ERROR = [
  "TypeError: Cannot read properties of undefined (reading 'length')",
  '    at summarize (/app/src/orders.js:14:29)',
  '    at Server.<anonymous> (/app/src/server.js:20:31)',
  `    connecting with ${DB_VALUE}`,
  '    callback https://hooks.example.com/notify?token=abcd1234efgh5678',
].join('\n');

function input(extra: Partial<FixBriefInput> = {}): FixBriefInput {
  return {
    incident: createIncident({ app: 'shop', kind: 'runtime', signals: [], now: new Date('2026-10-23T08:00:00Z'), id: 'inc-20261023-080000-abcd' }),
    hypothesis: HYP,
    error: ERROR,
    root: DEMO,
    endpoint: 'GET /api/orders/5',
    release: 'v7',
    envNames: ['DATABASE_URL', 'PORT'],
    knownSecrets: ['Sup3rS3cret'],
    ...extra,
  };
}

describe('fix brief (T8.14)', () => {
  it('http-500: all 7 sections, project-mapped location, exact reproduce commands', () => {
    const md = buildFixBrief(input());
    for (const s of FIX_BRIEF_SECTIONS) expect(md).toContain(`. ${s}`);
    expect(md).toContain('`src/orders.js`, line 14, function `summarize`');
    expect(md).toContain('PORT=3000 npm start');
    expect(md).toContain('curl -i http://localhost:3000/api/orders/5');
    expect(md).toContain('npm test');
    expect(md).toContain('report_fix_done({ incidentId: "inc-20261023-080000-abcd" })');
    expect(md).toMatchSnapshot();
  });

  it('redaction: no secret values, credentials or tokens — only env names', () => {
    const md = buildFixBrief(input());
    expect(md).not.toContain('Sup3rS3cret');
    expect(md).not.toContain('abcd1234efgh5678');
    expect(md).toContain('`DATABASE_URL`');
  });

  it('evidence is capped at 15 lines', () => {
    const long = [ERROR.split('\n')[0], ...Array.from({ length: 40 }, (_, i) => `    at f${i} (/app/src/x.js:${i + 1}:1)`)].join('\n');
    const md = buildFixBrief(input({ error: long }));
    const block = md.split('```text')[1]!.split('```')[0]!.trim().split('\n');
    expect(block).toHaveLength(15);
  });

  it('delivery: written to .siavash/fix-briefs, printed when there is no clipboard', async () => {
    const ui = new ScriptedUi([]);
    const r = await deliverFixBrief(tmp, input({ root: DEMO }), ui, { copy: async () => false });
    expect(r.path).toBe(join(tmp, '.siavash', 'fix-briefs', 'inc-20261023-080000-abcd.md'));
    expect(existsSync(r.path) && readFileSync(r.path, 'utf8')).toBe(r.markdown);
    expect(ui.notes.some((n) => n.body === r.markdown)).toBe(true);
  });

  it('clipboard: falls through the platform tools, false when none works', async () => {
    const tried: string[] = [];
    const run = (async (cmd: string) => {
      tried.push(cmd);
      if (cmd !== 'xclip') throw new Error('missing');
      return {};
    }) as unknown as Parameters<typeof copyToClipboard>[2];
    expect(await copyToClipboard('x', 'linux', run)).toBe(true);
    expect(tried).toEqual(['wl-copy', 'xclip']);
    expect(await copyToClipboard('x', 'aix', run)).toBe(false);
  });
});
