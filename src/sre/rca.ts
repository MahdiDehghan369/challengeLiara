import { z } from 'zod';
import { loadPrompt } from '../llm/prompts/index.js';
import { askStructured } from '../llm/structured.js';
import type { LlmClient } from '../llm/types.js';
import { redactText } from '../safety/redact.js';
import { LlmError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { Signal } from './detectors/types.js';
import { ACTION_TYPES, CATEGORIES, type ActionType, type KnowledgeCategory } from './knowledge/index.js';
import type { LogAnalysis, LogFinding } from './log-analyzer.js';
import type { Snapshot } from './snapshot.js';

/**
 * RCA engine (T8.4). Every input becomes a referenceable evidence item (`log:n`, `event:n`, `metric:…`,
 * `probe:0`, `timeline:n`). Rule-based hypotheses come from detector signals + knowledge-base matches;
 * LLM hypotheses must cite those refs: the anti-hallucination rule (in code) drops evidence whose ref
 * does not exist or whose quote is not in that item, scales confidence by the share kept, and drops a
 * hypothesis left without evidence. A strong knowledge-base match keeps confidence ≥ 0.6.
 */

export type EvidenceType = 'log' | 'metric' | 'probe' | 'event' | 'timeline';

export interface EvidenceItem {
  ref: string;
  type: EvidenceType;
  text: string;
  /** The log finding came from the knowledge base. */
  kb?: boolean;
}

export interface Evidence {
  type: EvidenceType;
  ref: string;
  quote: string;
}

export interface ProposedFix {
  actionType: ActionType;
  params?: Record<string, string | number | boolean>;
  expectedEffectFa: string;
}

export interface Hypothesis {
  id: string;
  titleFa: string;
  category: KnowledgeCategory;
  confidence: number;
  evidence: Evidence[];
  explanationFa: string;
  proposedFixes: ProposedFix[];
  howToVerifyFa: string;
  source: 'rules' | 'llm' | 'rules+llm';
}

export interface TimelineItem {
  ts: number;
  kind: 'deploy' | 'env-change' | 'restart';
  text: string;
}

export interface RcaInput {
  snapshot: Snapshot;
  signals: Signal[];
  logs: LogAnalysis;
  /** Default: built from the snapshot (last deploy, deploy/restart events, env changes). */
  timeline?: TimelineItem[];
  userDescription?: string;
}

export interface RcaResult {
  hypotheses: Hypothesis[];
  catalog: EvidenceItem[];
  llm: { used: boolean; model?: string; errorFa?: string; droppedEvidence: number; droppedHypotheses: number };
}

export const KB_MIN_CONFIDENCE = 0.6;
const MAX_HYPOTHESES = 3;
const QUOTE_MAX = 300;

// ---- evidence catalog --------------------------------------------------------

export function buildTimeline(s: Snapshot): TimelineItem[] {
  const out: TimelineItem[] = [];
  const d = s.sources.lastDeploy.ok ? s.sources.lastDeploy.value : undefined;
  if (d) out.push({ ts: Date.parse(d.startedAt), kind: 'deploy', text: `deploy ${d.version ?? d.id} (${d.mode}) result=${d.result}` });
  if (s.sources.events.ok) {
    for (const e of s.sources.events.value) {
      if (e.kind === 'deploy') out.push({ ts: e.ts ?? 0, kind: 'deploy', text: e.message });
      if (e.kind === 'restart') out.push({ ts: e.ts ?? 0, kind: 'restart', text: e.message });
    }
  }
  if (s.sources.envChanges.ok) {
    for (const c of s.sources.envChanges.value) out.push({ ts: Date.parse(c.ts), kind: 'env-change', text: `${c.tool} ${c.keys.join(', ')} (${c.result})` });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export function buildCatalog(input: RcaInput): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const s = input.snapshot;
  input.logs.findings.forEach((f, i) => items.push({ ref: `log:${i + 1}`, type: 'log', text: redactText(f.sample), kb: f.source === 'kb' }));
  // log lines that detectors cited but that are not part of a finding (e.g. info-level)
  for (const sig of input.signals) {
    for (const r of sig.evidence.logRefs ?? []) {
      if (!items.some((it) => it.type === 'log' && it.text.includes(r.snippet.split('\n')[0] ?? r.snippet))) {
        items.push({ ref: `log:${items.filter((x) => x.type === 'log').length + 1}`, type: 'log', text: redactText(r.snippet) });
      }
    }
  }
  if (s.sources.events.ok) s.sources.events.value.slice(-20).forEach((e, i) => items.push({ ref: `event:${i + 1}`, type: 'event', text: `${e.kind}: ${e.message}` }));
  if (s.sources.metrics.ok) {
    for (const kind of ['cpu', 'memory'] as const) {
      for (const a of s.sources.metrics.value[kind].applets) {
        items.push({
          ref: `metric:${kind}:${a.applet}`,
          type: 'metric',
          text: `${kind} ${a.applet} current=${a.stats.current} max=${a.stats.max} p95=${a.stats.p95} pctMax=${a.percent.max ?? 'unknown'} growth=${a.growth.detected} sawtooth=${a.sawtooth.detected}`,
        });
      }
    }
  }
  if (s.sources.probe.ok) {
    const p = s.sources.probe.value;
    items.push({ ref: 'probe:0', type: 'probe', text: `availability=${p.availability} p95=${p.p95} status=${JSON.stringify(p.statusHistogram)} errors=${JSON.stringify(p.errorHistogram)}` });
  }
  (input.timeline ?? buildTimeline(s)).forEach((t, i) => items.push({ ref: `timeline:${i + 1}`, type: 'timeline', text: `${new Date(t.ts).toISOString()} ${t.kind}: ${t.text}` }));
  return items;
}

const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();

/** The anti-hallucination check: the ref exists and the quote is really in it. */
export function validEvidence(e: { ref: string; quote: string }, catalog: EvidenceItem[]): EvidenceItem | undefined {
  const item = catalog.find((c) => c.ref === e.ref);
  const q = norm(e.quote ?? '');
  if (!item || !q) return undefined;
  return norm(item.text).includes(q) ? item : undefined;
}

// ---- rule-based hypotheses ------------------------------------------------------

interface Rule {
  signal: string;
  confidence: number;
  category: KnowledgeCategory;
  fixes: (sig: Signal) => Array<Omit<ProposedFix, 'expectedEffectFa'>>;
}

const RULES: Rule[] = [
  { signal: 'missing-env', confidence: 0.8, category: 'config', fixes: (s) => [{ actionType: 'set_env', ...(s.detail ? { params: { name: s.detail } } : {}) }] },
  { signal: 'db-connection', confidence: 0.8, category: 'config', fixes: () => [{ actionType: 'set_env', params: { name: 'DATABASE_URL' } }] },
  { signal: 'oom', confidence: 0.75, category: 'resource', fixes: () => [{ actionType: 'resize_app', params: { direction: 'up' } }] },
  { signal: 'port-mismatch', confidence: 0.7, category: 'config', fixes: () => [{ actionType: 'config_file' }] },
  { signal: 'disk-full', confidence: 0.7, category: 'resource', fixes: () => [{ actionType: 'manual' }] },
  { signal: 'read-only-fs', confidence: 0.7, category: 'config', fixes: () => [{ actionType: 'set_read_only', params: { on: false } }, { actionType: 'create_disk' }] },
  { signal: 'module-not-found', confidence: 0.6, category: 'dependency', fixes: () => [{ actionType: 'redeploy_app' }, { actionType: 'code_patch' }] },
  { signal: 'unhandled-exception', confidence: 0.6, category: 'code', fixes: () => [{ actionType: 'code_patch' }, { actionType: 'rollback_app' }] },
  { signal: 'http-5xx-rate', confidence: 0.55, category: 'code', fixes: () => [{ actionType: 'code_patch' }, { actionType: 'rollback_app' }] },
  { signal: 'tls-issue', confidence: 0.6, category: 'network', fixes: () => [{ actionType: 'manual' }] },
  { signal: 'memory-leak-trend', confidence: 0.5, category: 'code', fixes: () => [{ actionType: 'restart_app' }, { actionType: 'code_patch' }] },
  { signal: 'cpu-saturation', confidence: 0.45, category: 'resource', fixes: () => [{ actionType: 'resize_app', params: { direction: 'up' } }] },
  { signal: 'slow-response', confidence: 0.4, category: 'resource', fixes: () => [{ actionType: 'resize_app', params: { direction: 'up' } }] },
];

const effect = (a: ActionType) => fa.rca.effect[a] ?? fa.rca.effect.manual!;
const verifyFor = (a: ActionType | undefined) => (a && fa.rca.verify[a]) || fa.rca.verify.default!;

/** Catalog refs that support a signal (its log lines, probe, metrics, events). */
function refsForSignal(sig: Signal, catalog: EvidenceItem[]): Evidence[] {
  const out: Evidence[] = [];
  for (const r of sig.evidence.logRefs ?? []) {
    const line = (r.snippet.split('\n')[0] ?? r.snippet).slice(0, QUOTE_MAX);
    const item = catalog.find((c) => c.type === 'log' && norm(c.text).includes(norm(line)));
    if (item) out.push({ type: 'log', ref: item.ref, quote: line });
  }
  if (sig.evidence.probe) {
    const p = catalog.find((c) => c.ref === 'probe:0');
    if (p) out.push({ type: 'probe', ref: p.ref, quote: p.text.split(' ')[0]! });
  }
  if (sig.evidence.metric?.applet) {
    const m = catalog.find((c) => c.type === 'metric' && c.ref.endsWith(`:${String(sig.evidence.metric!.applet)}`));
    if (m) out.push({ type: 'metric', ref: m.ref, quote: m.text.split(' ').slice(0, 2).join(' ') });
  }
  for (const msg of sig.evidence.events ?? []) {
    const e = catalog.find((c) => c.type === 'event' && c.text.includes(msg));
    if (e && !out.some((x) => x.ref === e.ref)) out.push({ type: 'event', ref: e.ref, quote: msg.slice(0, QUOTE_MAX) });
  }
  return out;
}

function kbFixes(sig: Signal, findings: LogFinding[]): ProposedFix[] {
  const snippets = (sig.evidence.logRefs ?? []).map((r) => norm(r.snippet.split('\n')[0] ?? ''));
  const f = findings.find((x) => x.kbMatch && snippets.some((s) => s && norm(x.sample).includes(s)));
  return (f?.kbMatch?.fixes ?? []).map((k) => ({ actionType: k.actionType, ...(k.params ? { params: k.params } : {}), expectedEffectFa: k.descriptionFa }));
}

function mergeFixes(primary: ProposedFix[], extra: ProposedFix[]): ProposedFix[] {
  const out = [...primary];
  for (const f of extra) if (!out.some((x) => x.actionType === f.actionType)) out.push(f);
  return out;
}

export function ruleHypotheses(input: RcaInput, catalog: EvidenceItem[]): Hypothesis[] {
  const out: Hypothesis[] = [];
  const byId = new Map(input.signals.map((s) => [s.id, s]));
  for (const rule of RULES) {
    const sig = byId.get(rule.signal);
    if (!sig) continue;
    const evidence = refsForSignal(sig, catalog);
    const fixes = mergeFixes(rule.fixes(sig).map((f) => ({ ...f, expectedEffectFa: effect(f.actionType) })), kbFixes(sig, input.logs.findings));
    const kb = evidence.some((e) => catalog.find((c) => c.ref === e.ref)?.kb);
    out.push({
      id: '',
      titleFa: sig.detail && rule.signal === 'missing-env' ? `${sig.titleFa}: ${sig.detail}` : sig.titleFa,
      category: rule.category,
      confidence: kb ? Math.max(rule.confidence, KB_MIN_CONFIDENCE) : rule.confidence,
      evidence,
      explanationFa: fa.rca.explain[rule.signal] ?? sig.titleFa,
      proposedFixes: fixes,
      howToVerifyFa: verifyFor(fixes[0]?.actionType),
      source: 'rules',
    });
  }

  // a release that does not start: the latest deploy precedes the crash and code/files are missing
  const timeline = input.timeline ?? buildTimeline(input.snapshot);
  const lastDeploy = [...timeline].reverse().find((t) => t.kind === 'deploy');
  const crashLike = byId.get('module-not-found') ?? byId.get('release-regression');
  if (lastDeploy && crashLike) {
    const firstError = Math.min(...(crashLike.evidence.logRefs ?? []).map((r) => r.ts), Number.POSITIVE_INFINITY);
    if (byId.has('release-regression') || firstError >= lastDeploy.ts) {
      const tl = catalog.find((c) => c.type === 'timeline' && c.text.includes(lastDeploy.text));
      out.push({
        id: '',
        titleFa: fa.rca.regressionTitle,
        category: 'code',
        confidence: 0.7,
        evidence: [...(tl ? [{ type: 'timeline' as const, ref: tl.ref, quote: lastDeploy.text }] : []), ...refsForSignal(crashLike, catalog)],
        explanationFa: fa.rca.regressionExplain,
        proposedFixes: [{ actionType: 'rollback_app', expectedEffectFa: effect('rollback_app') }, { actionType: 'code_patch', expectedEffectFa: effect('code_patch') }],
        howToVerifyFa: verifyFor('rollback_app'),
        source: 'rules',
      });
    }
  }

  // only symptoms: the app is down but nothing points at a cause
  if (out.length === 0 && (byId.has('app-down') || byId.has('crash-loop'))) {
    const sig = (byId.get('crash-loop') ?? byId.get('app-down'))!;
    out.push({
      id: '',
      titleFa: fa.rca.symptomTitle,
      category: 'platform',
      confidence: 0.3,
      evidence: refsForSignal(sig, catalog),
      explanationFa: fa.rca.symptomExplain,
      proposedFixes: [{ actionType: 'restart_app', expectedEffectFa: effect('restart_app') }],
      howToVerifyFa: verifyFor('restart_app'),
      source: 'rules',
    });
  }
  return out;
}

// ---- LLM hypotheses ---------------------------------------------------------------

const LlmRcaSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        titleFa: z.string().min(1),
        category: z.enum(CATEGORIES),
        confidence: z.number().min(0).max(1),
        evidence: z.array(z.object({ ref: z.string(), quote: z.string() })).default([]),
        explanationFa: z.string().min(1),
        proposedFixes: z
          .array(
            z.object({
              actionType: z.enum(ACTION_TYPES),
              params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
              expectedEffectFa: z.string().default(''),
            }),
          )
          .default([]),
        howToVerifyFa: z.string().default(''),
      }),
    )
    .default([]),
  summaryFa: z.string().optional(),
});

/** Applies the anti-hallucination rule; returns undefined when no evidence survives. */
export function groundHypothesis(
  h: z.infer<typeof LlmRcaSchema>['hypotheses'][number],
  catalog: EvidenceItem[],
): { hypothesis: Hypothesis | undefined; dropped: number } {
  const kept: Evidence[] = [];
  let kb = false;
  for (const e of h.evidence) {
    const item = validEvidence(e, catalog);
    if (!item) continue;
    kept.push({ type: item.type, ref: item.ref, quote: e.quote.slice(0, QUOTE_MAX) });
    if (item.kb) kb = true;
  }
  const dropped = h.evidence.length - kept.length;
  if (kept.length === 0) return { hypothesis: undefined, dropped };
  let confidence = h.confidence * (kept.length / h.evidence.length);
  if (kb) confidence = Math.max(confidence, KB_MIN_CONFIDENCE);
  return {
    dropped,
    hypothesis: {
      id: '',
      titleFa: h.titleFa,
      category: h.category,
      confidence,
      evidence: kept,
      explanationFa: h.explanationFa,
      proposedFixes: h.proposedFixes.map((f) => ({ ...f, expectedEffectFa: f.expectedEffectFa || effect(f.actionType) })),
      howToVerifyFa: h.howToVerifyFa || verifyFor(h.proposedFixes[0]?.actionType),
      source: 'llm',
    },
  };
}

function sameCause(a: Hypothesis, b: Hypothesis): boolean {
  return a.category === b.category && a.proposedFixes[0]?.actionType === b.proposedFixes[0]?.actionType;
}

export async function runRca(input: RcaInput, ctx: { llm?: LlmClient; app?: string; signal?: AbortSignal } = {}): Promise<RcaResult> {
  const catalog = buildCatalog(input);
  const hyps = ruleHypotheses(input, catalog);
  const llmInfo: RcaResult['llm'] = { used: false, droppedEvidence: 0, droppedHypotheses: 0 };

  if (ctx.llm) {
    try {
      const res = await askStructured(ctx.llm, {
        role: 'reasoning',
        prompt: loadPrompt('rca', { app: ctx.app ?? input.snapshot.app }),
        data: [
          { label: 'evidence', text: catalog.map((c) => `[${c.ref}] ${c.text}`).join('\n') },
          { label: 'signals', text: input.signals.map((s) => `${s.id} (${s.severity})${s.detail ? `: ${s.detail}` : ''}`).join('\n') || '-' },
          ...(input.userDescription ? [{ label: 'user-description', text: input.userDescription }] : []),
        ],
        schema: LlmRcaSchema,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      llmInfo.used = true;
      llmInfo.model = res.model;
      for (const raw of res.value.hypotheses) {
        const { hypothesis, dropped } = groundHypothesis(raw, catalog);
        llmInfo.droppedEvidence += dropped;
        if (!hypothesis) {
          llmInfo.droppedHypotheses++;
          continue;
        }
        const twin = hyps.find((x) => sameCause(x, hypothesis));
        if (twin) {
          twin.confidence = Math.max(twin.confidence, hypothesis.confidence);
          for (const e of hypothesis.evidence) if (!twin.evidence.some((x) => x.ref === e.ref)) twin.evidence.push(e);
          twin.explanationFa = hypothesis.explanationFa;
          twin.source = 'rules+llm';
        } else {
          hyps.push(hypothesis);
        }
      }
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      llmInfo.errorFa = fa.rca.llmUnavailable;
    }
  }

  const top = hyps
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_HYPOTHESES)
    .map((h, i) => ({ ...h, id: `h${i + 1}`, confidence: Math.round(h.confidence * 100) / 100 }));
  return { hypotheses: top, catalog, llm: llmInfo };
}
