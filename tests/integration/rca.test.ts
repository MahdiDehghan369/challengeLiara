import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createLiaraClient, type LiaraClient, type ScenarioKind } from '../../src/liara/index.js';
import { MockLlm, type ChatRequest } from '../../src/llm/index.js';
import { runDetectors } from '../../src/sre/detectors/index.js';
import { analyzeLogs } from '../../src/sre/log-analyzer.js';
import { groundHypothesis, runRca, validEvidence, type EvidenceItem } from '../../src/sre/rca.js';
import { takeSnapshot } from '../../src/sre/snapshot.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-rca-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});
const noKeepAlive: typeof fetch = (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), connection: 'close' } });

async function scenario(kind: ScenarioKind) {
  const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: join(mkdtempSync(join(root, 'd-')), 'data') }, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const mock = liara.mock!.state;
  const app = mock.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  mock.createRelease(app, { sourceID: mock.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  await mock.settle();
  mock.injectScenario('shop', kind);
  const snapshot = await takeSnapshot('shop', 900, {
    liara,
    urlFor: (n) => liara.mock!.servers.urlFor(n),
    probe: { count: 2, timeoutMs: 5000, fetchImpl: noKeepAlive },
    // the mock reports bytes / cores
    units: { cpu: 'cores', memory: 'bytes' },
    catalog: { planById: async () => ({ id: 'small-g2', kind: 'app', cpu: 0.5, ramMb: 512, diskGb: 5, priceMonthlyToman: 1, bundlePricesToman: {}, available: true }) } as never,
  });
  const signals = runDetectors(snapshot);
  const logs = await analyzeLogs(snapshot.sources.logs.ok ? snapshot.sources.logs.value : []);
  return { snapshot, signals, logs };
}

/** An LLM that confidently invents evidence. */
const lyingLlm = () =>
  new MockLlm().on(() => true, {
    content: JSON.stringify({
      hypotheses: [
        {
          titleFa: 'حملهٔ شبکه‌ای',
          category: 'network',
          confidence: 0.95,
          evidence: [{ ref: 'log:99', quote: 'DDoS detected from 1.2.3.4' }, { ref: 'probe:0', quote: 'firewall blocked' }],
          explanationFa: 'ساختگی',
          proposedFixes: [{ actionType: 'manual' }],
          howToVerifyFa: '',
        },
      ],
    }),
  });

const EXPECTED: Array<[ScenarioKind, string, Record<string, unknown> | undefined]> = [
  ['missing-env', 'set_env', undefined],
  ['oom', 'resize_app', undefined],
  ['http-500', 'code_patch', undefined],
  ['bad-release', 'rollback_app', undefined],
  ['db-connection', 'set_env', { name: 'DATABASE_URL' }],
];

describe('RCA on mock scenarios (acceptance)', () => {
  it.each(EXPECTED)('%s → first hypothesis proposes %s; fabricated evidence is dropped', async (kind, action, params) => {
    const input = await scenario(kind);
    const llm = lyingLlm();
    const r = await runRca(input, { llm, app: 'shop' });
    const first = r.hypotheses[0]!;
    expect(first.proposedFixes[0]?.actionType).toBe(action);
    if (params) expect(first.proposedFixes[0]?.params).toMatchObject(params);
    expect(first.evidence.length).toBeGreaterThan(0);
    for (const e of first.evidence) expect(validEvidence(e, r.catalog)).toBeDefined();
    expect(first.explanationFa).toMatch(/[؀-ۿ]/);
    // the invented hypothesis is gone
    expect(r.hypotheses.some((h) => h.category === 'network')).toBe(false);
    expect(r.llm).toMatchObject({ used: true, droppedHypotheses: 1, droppedEvidence: 2 });
    expect(r.hypotheses.length).toBeLessThanOrEqual(3);
    expect(r.hypotheses.map((h) => h.id)).toEqual(r.hypotheses.map((_, i) => `h${i + 1}`));
    // the LLM saw the evidence catalog inside <data>
    const sent = (llm.calls[0] as ChatRequest).messages.map((m) => m.content ?? '').join('\n');
    expect(sent).toContain('<data source="evidence">');
  });

  it('without an LLM the rule-based ranking stands; with the KB boost confidence ≥ 0.6', async () => {
    const input = await scenario('db-connection');
    const r = await runRca(input);
    expect(r.llm.used).toBe(false);
    expect(r.hypotheses[0]).toMatchObject({ category: 'config', source: 'rules' });
    expect(r.hypotheses[0]!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('a grounded LLM hypothesis merges with the matching rule hypothesis', async () => {
    const input = await scenario('missing-env');
    const plain = await runRca(input);
    const quoteRef = plain.catalog.find((c) => c.type === 'log' && /Invalid URL/.test(c.text))!;
    const llm = new MockLlm().on(() => true, {
      content: JSON.stringify({
        hypotheses: [
          {
            titleFa: 'DATABASE_URL تنظیم نشده',
            category: 'config',
            confidence: 0.9,
            evidence: [{ ref: quoteRef.ref, quote: 'Invalid URL' }],
            explanationFa: 'متغیر DATABASE_URL خالی است و new URL خطا می‌دهد.',
            proposedFixes: [{ actionType: 'set_env', params: { name: 'DATABASE_URL' }, expectedEffectFa: 'x' }],
            howToVerifyFa: 'y',
          },
        ],
      }),
    });
    const r = await runRca(input, { llm });
    expect(r.hypotheses[0]).toMatchObject({ source: 'rules+llm', confidence: 0.9, explanationFa: 'متغیر DATABASE_URL خالی است و new URL خطا می‌دهد.' });
    expect(r.llm.droppedHypotheses).toBe(0);
  });
});

describe('anti-hallucination rule (unit)', () => {
  const catalog: EvidenceItem[] = [
    { ref: 'log:1', type: 'log', text: "Error: Cannot find module './config'", kb: true },
    { ref: 'probe:0', type: 'probe', text: 'availability=0 p95=12' },
  ];
  const h = (evidence: Array<{ ref: string; quote: string }>, confidence = 0.8) => ({
    titleFa: 't',
    category: 'code' as const,
    confidence,
    evidence,
    explanationFa: 'e',
    proposedFixes: [{ actionType: 'code_patch' as const, expectedEffectFa: '' }],
    howToVerifyFa: '',
  });

  it('quote must be inside the referenced item (case/whitespace-insensitive)', () => {
    expect(validEvidence({ ref: 'log:1', quote: "cannot  find module './config'" }, catalog)).toBeDefined();
    expect(validEvidence({ ref: 'log:1', quote: 'Cannot find module express' }, catalog)).toBeUndefined();
    expect(validEvidence({ ref: 'log:7', quote: 'Error' }, catalog)).toBeUndefined();
    expect(validEvidence({ ref: 'log:1', quote: '' }, catalog)).toBeUndefined();
  });

  it('confidence scales with the share of valid evidence; KB-backed stays ≥ 0.6; none valid → dropped', () => {
    const half = groundHypothesis(h([{ ref: 'probe:0', quote: 'availability=0' }, { ref: 'log:9', quote: 'x' }]), catalog);
    expect(half.dropped).toBe(1);
    expect(half.hypothesis?.confidence).toBeCloseTo(0.4, 5);
    const kb = groundHypothesis(h([{ ref: 'log:1', quote: 'Cannot find module' }, { ref: 'log:9', quote: 'x' }, { ref: 'log:8', quote: 'y' }], 0.6), catalog);
    expect(kb.hypothesis?.confidence).toBe(0.6);
    expect(groundHypothesis(h([{ ref: 'log:9', quote: 'x' }]), catalog).hypothesis).toBeUndefined();
  });
});
