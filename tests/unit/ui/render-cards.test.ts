import { describe, expect, it } from 'vitest';
import type { AppOverview } from '../../../src/ops/service.js';
import { Risk } from '../../../src/safety/risk.js';
import type { Signal } from '../../../src/sre/detectors/types.js';
import { healthScore } from '../../../src/sre/health-score.js';
import type { Hypothesis, RcaResult } from '../../../src/sre/rca.js';
import type { RemediationOption, RemediationPlan } from '../../../src/sre/remediate.js';
import type { ComparisonRow } from '../../../src/sre/verify.js';
import { CARD_MAX_LINES, renderComparisonTable, renderFindings, renderHypothesisCard, renderKnownLimits, renderLimitCard, renderOverviewCard } from '../../../src/ui/cli/render/index.js';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const opts = { color: false };

const H1: Hypothesis = {
  id: 'h1',
  titleFa: 'متغیر DATABASE_URL تعریف نشده',
  category: 'config',
  confidence: 0.9,
  evidence: [
    { type: 'log', ref: 'log:1', quote: 'TypeError [ERR_INVALID_URL]: Invalid URL at new URL (node:internal/url:816:29) connecting postgres://app:s3cretpw@db:5432/x' },
    { type: 'event', ref: 'event:1', quote: 'Back-off restarting failed container' },
    { type: 'probe', ref: 'probe:1', quote: 'GET / → 502 (2/2)' },
    { type: 'metric', ref: 'metric:1', quote: 'restarts: 6 in 10 min' },
  ],
  explanationFa: 'اپ موقع شروع آدرس دیتابیس را از محیط می‌خواند و چون نیست، بالا نمی‌آید.',
  proposedFixes: [],
  howToVerifyFa: '',
  source: 'rules',
};
const H2: Hypothesis = { ...H1, id: 'h2', titleFa: 'کد اپ ماژول را پیدا نمی‌کند', confidence: 0.35, category: 'code' };
const fix = (kind: 'quick' | 'root', risk: Risk, titleFa: string, needsInput: string[] = []): RemediationOption => ({ hypothesisId: 'h1', confidence: 0.9, tool: kind === 'quick' ? 'restart_app' : 'set_env', risk, kind, titleFa, expectedEffectFa: '', args: {}, needsInput });
const PLAN: RemediationPlan = { quickFix: fix('quick', Risk.R1, 'ری‌استارت اپ'), rootFix: fix('root', Risk.R2, 'تنظیم DATABASE_URL', ['value']), options: [] };
const SIGNALS: Signal[] = [{ id: 'crash-loop', severity: 'critical', titleFa: 'اپ مدام ری‌استارت می‌شود', detail: '', evidence: [] } as unknown as Signal];

const OVERVIEW: AppOverview = {
  app: 'shop',
  status: { ok: true, value: { name: 'shop', status: 'ACTIVE', scale: 1, planID: 'small-g2', platform: 'node', isDeployed: true, createdAt: '2026-10-01T00:00:00Z' } },
  plan: { ok: true, value: { id: 'small-g2', kind: 'app', cpu: 0.5, ramMb: 512, diskGb: 5, priceMonthlyToman: 474998, bundlePricesToman: {} } as never },
  lastDeploy: { ok: true, value: { id: 'd1', app: 'shop', mode: 'cli', gitDirty: false, startedAt: new Date(NOW - 2 * 3600_000).toISOString(), result: 'success', version: 'v7' } },
  envCount: { ok: true, value: 4 },
  domains: { ok: true, value: [{ name: 'shop.example.com', status: 'CONNECTED', certificatesStatus: 'ACTIVE' }] },
  disks: { ok: true, value: [{ name: 'data', usagePercent: 83 } as never] },
  metrics: { ok: true, value: { units: { cpu: 'cores', memory: 'bytes' }, applets: [{ applet: 'web', cpu: 0.1, memory: 200, cpuPct: 20, memoryPct: 71 }] } },
  events: { ok: true, value: [{ ts: NOW - 600_000, kind: 'restart', message: 'App restarted' }] },
  probe: { ok: false, errorFa: 'x', code: 'TIMEOUT' },
  partial: true,
  failed: ['probe'],
};

describe('cards (T9.4)', () => {
  it('hypothesis card: confidence bar, plain words, ≤ 3 redacted evidence lines with time, risk-tagged fixes', () => {
    const card = renderHypothesisCard(H1, 1, [PLAN.rootFix!, PLAN.quickFix!], { ...opts, evidenceTimes: new Map([['log:1', NOW - 60_000]]) });
    expect(card).toMatchSnapshot();
    expect(card).not.toContain('s3cretpw');
    expect(card.split('\n').filter((l) => l.startsWith('  • '))).toHaveLength(3);
    expect(card).toContain('[R2]');
  });

  it('findings: problem + top card + the other hypotheses in one line each', () => {
    const rca: RcaResult = { hypotheses: [H1, H2], catalog: [], llm: { used: false, droppedEvidence: 0, droppedHypotheses: 0 } };
    expect(renderFindings(rca, PLAN, SIGNALS, opts)).toMatchSnapshot();
  });

  it('overview card with health score; failed sources are named', () => {
    const health = healthScore('shop', SIGNALS);
    const card = renderOverviewCard(OVERVIEW, { ...opts, health, now: NOW });
    expect(card).toMatchSnapshot();
    expect(card).toContain('probe');
  });

  it('before/after table', () => {
    const rows: ComparisonRow[] = [
      { key: 'availability', labelFa: 'دسترس‌پذیری', before: '0%', after: '100%', better: true },
      { key: 'p95', labelFa: 'p95', before: '-', after: '120ms', better: undefined },
      { key: 'errorRate', labelFa: 'نرخ خطا', before: '2%', after: '5%', better: false },
    ] as ComparisonRow[];
    expect(renderComparisonTable(rows, opts)).toMatchSnapshot();
  });

  it('limit cards', () => {
    expect(renderLimitCard({ whatFa: 'خرید دامنه', whyFa: 'لیارا API خرید دامنه ندارد', alternativesFa: ['دامنه را از ثبت‌کننده بخرید', 'بعد siavash domain add'] }, opts)).toMatchSnapshot();
    expect(renderKnownLimits(opts)).toContain('شارژ حساب لیارا');
  });

  it('cards stay within ~25 lines unless --verbose', () => {
    const many: Hypothesis = { ...H1, evidence: Array.from({ length: 40 }, (_, i) => ({ type: 'log' as const, ref: `log:${i}`, quote: `line ${i}` })) };
    const short = renderHypothesisCard(many, 1, [], opts).split('\n');
    expect(short.length).toBeLessThanOrEqual(CARD_MAX_LINES);
    const long = renderHypothesisCard(many, 1, [], { ...opts, verbose: true }).split('\n');
    expect(long.length).toBeGreaterThan(CARD_MAX_LINES);
    const rca: RcaResult = { hypotheses: Array.from({ length: 30 }, (_, i) => ({ ...H2, id: `h${i}` })), catalog: [], llm: { used: false, droppedEvidence: 0, droppedHypotheses: 0 } };
    expect(renderFindings(rca, PLAN, SIGNALS, opts).split('\n').length).toBeLessThanOrEqual(CARD_MAX_LINES);
  });
});
