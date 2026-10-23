import { z } from 'zod';
import { loadPrompt } from '../llm/prompts/index.js';
import { askStructured } from '../llm/structured.js';
import type { LlmClient } from '../llm/types.js';
import { LlmError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';

/**
 * Intent router (T3.7): Persian/English keyword rules first; only an ambiguous message (no hit, or a tie)
 * goes to the `cheap` LLM with a JSON answer. deploy / diagnose are run directly as pipelines by the chat.
 */

export const INTENTS = ['deploy', 'redeploy', 'diagnose', 'status', 'manage', 'domain', 'question', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

export interface IntentResult {
  intent: Intent;
  confidence: number;
  source: 'rules' | 'llm' | 'none';
  /** Keywords that matched (rules). */
  matched: string[];
  app?: string;
}

type Scored = Exclude<Intent, 'other'>;

const EN: Record<Scored, string[]> = {
  deploy: ['deploy', 'publish', 'go live', 'upload', 'launch'],
  redeploy: ['redeploy', 'deploy again', 're-deploy', 'push the new version'],
  diagnose: ['slow', 'error', 'crash', 'down', 'broken', 'not working', 'timeout', 'bug', 'debug', 'diagnose', 'why is'],
  status: ['status', 'health', 'logs', 'uptime', 'usage', 'overview'],
  manage: ['restart', 'stop', 'start the app', 'resize', 'upgrade plan', 'env var', 'rollback', 'roll back', 'backup', 'disk', 'delete'],
  domain: ['domain', 'dns', 'ssl', 'certificate', 'cname', 'redirect'],
  question: ['what is', 'how do', 'how much', 'price', 'cost', 'difference', 'can i'],
};

/** Question words are weak on their own: "how is my site doing?" is status, not a question. */
const WEIGHT: Partial<Record<Scored, number>> = { question: 0.5 };
/** Tie order: the more specific / urgent intent wins. */
const PRIORITY: Scored[] = ['redeploy', 'diagnose', 'domain', 'manage', 'deploy', 'status', 'question'];

const FA_ZERO = 0x06f0;
const AR_ZERO = 0x0660;

/** Lower case, ی/ک unified, no ZWNJ / tatweel, Persian and Arabic digits as ASCII, single spaces. */
export function normalizeText(s: string): string {
  return [...s.toLowerCase()]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= FA_ZERO && code <= FA_ZERO + 9) return String(code - FA_ZERO);
      if (code >= AR_ZERO && code <= AR_ZERO + 9) return String(code - AR_ZERO);
      if (code === 0x064a) return String.fromCharCode(0x06cc); // Arabic yeh → Persian yeh
      if (code === 0x0643) return String.fromCharCode(0x06a9); // Arabic kaf → Persian kaf
      if (code === 0x200c || code === 0x0640) return ''; // ZWNJ, tatweel
      return ch;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

const KEYWORDS: Record<Scored, string[]> = Object.fromEntries(
  (Object.keys(EN) as Scored[]).map((k) => [k, [...(fa.intent.keywords[k] ?? []), ...EN[k]].map(normalizeText)]),
) as Record<Scored, string[]>;

export function classifyByRules(text: string): IntentResult & { ambiguous: boolean } {
  const t = normalizeText(text);
  const scores = new Map<Scored, number>();
  const matched: string[] = [];
  for (const intent of PRIORITY) {
    for (const k of KEYWORDS[intent]) {
      if (k && t.includes(k)) {
        scores.set(intent, (scores.get(intent) ?? 0) + (WEIGHT[intent] ?? 1));
        matched.push(k);
      }
    }
  }
  // "deploy again" contains "deploy": redeploy wins when both match
  if (scores.has('redeploy')) scores.delete('deploy');
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || PRIORITY.indexOf(a[0]) - PRIORITY.indexOf(b[0]));
  const [best, second] = ranked;
  if (!best) return { intent: 'other', confidence: 0, source: 'none', matched, ambiguous: true };
  const tie = second !== undefined && second[1] === best[1];
  const confidence = Math.min(0.95, 0.6 + 0.15 * best[1] - (tie ? 0.2 : 0));
  return { intent: best[0], confidence, source: 'rules', matched, ambiguous: tie };
}

const LlmIntentSchema = z.object({
  intent: z.enum(INTENTS),
  confidence: z.number().min(0).max(1).default(0.5),
  app: z.string().min(1).max(100).optional(),
});

/** Rules first; the LLM only for an ambiguous message (and only when one is given). */
export async function routeIntent(text: string, opts: { llm?: LlmClient; signal?: AbortSignal } = {}): Promise<IntentResult> {
  const rules = classifyByRules(text);
  if (!rules.ambiguous || !opts.llm) {
    const { ambiguous: _a, ...r } = rules;
    return r;
  }
  try {
    const res = await askStructured(opts.llm, {
      role: 'cheap',
      prompt: loadPrompt('intent'),
      data: [{ label: 'user-message', text: text.slice(0, 2000) }],
      schema: LlmIntentSchema,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { intent: res.value.intent, confidence: res.value.confidence, source: 'llm', matched: rules.matched, ...(res.value.app ? { app: res.value.app } : {}) };
  } catch (e) {
    if (!(e instanceof LlmError)) throw e;
    const { ambiguous: _a, ...r } = rules;
    return r;
  }
}
