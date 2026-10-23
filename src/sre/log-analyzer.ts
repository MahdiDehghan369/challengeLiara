import { z } from 'zod';
import type { LogLine } from '../liara/index.js';
import { loadPrompt } from '../llm/prompts/index.js';
import { askStructured } from '../llm/structured.js';
import type { LlmClient } from '../llm/types.js';
import { redactText } from '../safety/redact.js';
import { LlmError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { CATEGORIES, matchKnowledge, type CompiledPattern, type KnowledgeCategory, type KnowledgeFix } from './knowledge/index.js';
import { clusterLogs, type LogCluster } from './log-cluster.js';
import { detectLevel, mergeMultiline, type LogRecord } from './logs.js';

/**
 * Log analyzer (T8.3): cluster → knowledge base → LLM for the unmatched clusters only (top 20, redacted,
 * inside `<data>`). Without an LLM (or when it fails) only knowledge-base findings are returned.
 */

export type FindingSeverity = 'info' | 'warn' | 'critical';

export interface LogFinding {
  signature: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  sample: string;
  interpretationFa: string;
  category: KnowledgeCategory;
  severity: FindingSeverity;
  source: 'kb' | 'llm';
  kbMatch?: { id: string; titleFa: string; fixes: KnowledgeFix[] };
}

export interface LogAnalysis {
  findings: LogFinding[];
  clusters: number;
  /** Clusters neither the knowledge base nor the LLM explained. */
  unexplained: number;
  llm: { used: boolean; model?: string; errorFa?: string };
}

export interface AnalyzeLogsContext {
  llm?: LlmClient;
  platform?: string;
  maxLlmClusters?: number;
  knowledge?: CompiledPattern[];
  signal?: AbortSignal;
}

export const MAX_LLM_CLUSTERS = 20;
const SAMPLE_MAX = 800;

const LlmFindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        id: z.string(),
        interpretationFa: z.string().min(1),
        category: z.enum(CATEGORIES),
        severity: z.enum(['info', 'warn', 'critical']),
      }),
    )
    .default([]),
});

function kbSeverity(c: LogCluster): FindingSeverity {
  return c.count >= 3 ? 'critical' : 'warn';
}

function base(c: LogCluster) {
  return { signature: c.signature, count: c.count, firstSeen: c.firstSeen, lastSeen: c.lastSeen, sample: c.sample.slice(0, SAMPLE_MAX) };
}

export async function analyzeLogs(records: LogRecord[], ctx: AnalyzeLogsContext = {}): Promise<LogAnalysis> {
  const clusters = clusterLogs(records);
  const findings: LogFinding[] = [];
  const unmatched: LogCluster[] = [];
  for (const c of clusters) {
    const m = matchKnowledge(c.sample, { first: true, ...(ctx.knowledge ? { patterns: ctx.knowledge } : {}) })[0];
    if (m) {
      findings.push({
        ...base(c),
        interpretationFa: m.likelyCauseFa,
        category: m.pattern.category,
        severity: kbSeverity(c),
        source: 'kb',
        kbMatch: { id: m.pattern.id, titleFa: m.pattern.titleFa, fixes: m.fixes },
      });
    } else {
      unmatched.push(c);
    }
  }

  let llm: LogAnalysis['llm'] = { used: false };
  let explained = 0;
  if (ctx.llm && unmatched.length > 0) {
    const top = [...unmatched].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen).slice(0, ctx.maxLlmClusters ?? MAX_LLM_CLUSTERS);
    const byId = new Map(top.map((c, i) => [`c${i + 1}`, c]));
    const data = [...byId]
      .map(([id, c]) => `${id} (count=${c.count}, level=${c.level}, stream=${c.stream})\n${redactText(c.sample).slice(0, SAMPLE_MAX)}`)
      .join('\n\n---\n\n');
    try {
      const res = await askStructured(ctx.llm, {
        role: 'cheap',
        prompt: loadPrompt('summarize-logs', { platform: ctx.platform }),
        data: [{ label: 'log-clusters', text: data }],
        schema: LlmFindingsSchema,
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      });
      const seen = new Set<string>();
      for (const f of res.value.findings) {
        const c = byId.get(f.id);
        // only ids we sent, each once
        if (!c || seen.has(f.id)) continue;
        seen.add(f.id);
        findings.push({ ...base(c), interpretationFa: f.interpretationFa, category: f.category, severity: f.severity, source: 'llm' });
        explained++;
      }
      llm = { used: true, model: res.model };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      llm = { used: false, errorFa: fa.logAnalyzer.llmUnavailable };
    }
  }
  const order = { critical: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
  return { findings, clusters: clusters.length, unexplained: unmatched.length - explained, llm };
}

/** Build output (T5.7 failure tail / CLI lines) analysed the same way. */
export function analyzeBuildLog(lines: string[], ctx: AnalyzeLogsContext = {}, now = Date.now()): Promise<LogAnalysis> {
  const logLines: LogLine[] = lines.map((text, i) => ({ ts: now + i, stream: 'build', text, source: 'cli' }));
  const records: LogRecord[] = mergeMultiline(logLines).map((r) => ({ ...r, text: redactText(r.text), level: detectLevel(r.text) }));
  return analyzeLogs(records, ctx);
}
