/**
 * Limits catalog (T10.4). Every item says what is not possible, why, and what Siavash does instead.
 * The same data feeds `siavash limits`, the `get_limits` tool, the web panel and docs/API_LIMITS.md.
 */

import { LIMIT_CATEGORIES_FA, LIMITS_FA } from '../ui/cli/i18n/limits.fa.js';

const faOf = (id: string) => {
  const t = LIMITS_FA[id];
  if (!t) throw new Error(`limits catalog: no Persian text for ${id}`);
  return t;
};

export type LimitCategory = 'human-only' | 'api-gap' | 'unknown-behavior' | 'rate-limit' | 'llm' | 'agent';

export interface LimitItem {
  id: string;
  category: LimitCategory;
  whatFa: string;
  whyFa: string;
  alternativeFa: string;
  /** Short English line for LLM tool answers. */
  en: string;
}

export const CATEGORY_FA: Record<LimitCategory, string> = LIMIT_CATEGORIES_FA;

export const LIMITS: readonly LimitItem[] = [
  // (a) human-only
  {
    id: 'topup',
    category: 'human-only',
    ...faOf('topup'),
    en: 'Topping up the balance is human-only (bank gateway). The agent checks the balance and cost first and waits for the top-up.',
  },
  {
    id: 'buy-domain',
    category: 'human-only',
    ...faOf('buy-domain'),
    en: 'Buying a domain is human-only. The agent attaches it and tells the user which records to create.',
  },
  {
    id: 'registrar-dns',
    category: 'human-only',
    ...faOf('registrar-dns'),
    en: 'Registrar DNS changes are human-only. The agent shows the exact record and verifies it with DNS lookups before enabling SSL.',
  },
  // (b) API gaps
  {
    id: 'app-details',
    category: 'api-gap',
    ...faOf('app-details'),
    en: 'No documented app-details endpoint: list + filter is used.',
  },
  {
    id: 'releases',
    category: 'api-gap',
    ...faOf('releases'),
    en: 'No documented release list: a local deployment ledger plus events/logs is used.',
  },
  {
    id: 'rollback',
    category: 'api-gap',
    ...faOf('rollback'),
    en: 'No rollback API: the agent redeploys the last healthy source from its ledger (with approval).',
  },
  {
    id: 'env-read',
    category: 'api-gap',
    ...faOf('env-read'),
    en: 'Env vars are read via the Liara CLI; values are never shown or sent to the LLM.',
  },
  {
    id: 'plan-catalog',
    category: 'api-gap',
    ...faOf('plan-catalog'),
    en: 'Plan prices come from `liara plan:list` or a dated local catalog.',
  },
  {
    id: 'apm',
    category: 'api-gap',
    ...faOf('apm'),
    en: 'No APM/latency API: the agent probes the app URL itself.',
  },
  // (c) unknown behaviour
  {
    id: 'env-semantics',
    category: 'unknown-behavior',
    ...faOf('env-semantics'),
    en: 'update-envs replace/merge semantics unknown: read-merge-write is used so no variable is lost.',
  },
  {
    id: 'restart-confirmation',
    category: 'unknown-behavior',
    ...faOf('restart-confirmation'),
    en: 'Mutations return only "accepted": the agent polls real state and probes the URL to confirm.',
  },
  {
    id: 'metric-units',
    category: 'unknown-behavior',
    ...faOf('metric-units'),
    en: 'Some metric units are not documented: values are compared to plan limits and marked when unsure.',
  },
  // (d) rate limits
  {
    id: 'rate-limit',
    category: 'rate-limit',
    ...faOf('rate-limit'),
    en: 'Liara rate-limits the API (429): retries with backoff, per-session request budget and a loop breaker.',
  },
  // (e) LLM
  {
    id: 'llm-hallucination',
    category: 'llm',
    ...faOf('llm-hallucination'),
    en: 'LLM output can be wrong: every hypothesis must cite evidence; known patterns are matched without the LLM.',
  },
  {
    id: 'llm-secrets',
    category: 'llm',
    ...faOf('llm-secrets'),
    en: 'Logs are redacted and only unmatched error clusters reach the LLM.',
  },
  // (f) agent
  {
    id: 'no-24-7',
    category: 'agent',
    ...faOf('no-24-7'),
    en: 'No 24/7 monitoring: checks run on request; use Liara alerts or a cron running `siavash health`.',
  },
  {
    id: 'probabilistic',
    category: 'agent',
    ...faOf('probabilistic'),
    en: 'Diagnoses are probabilistic: ranked with confidence and evidence, and every fix is verified before/after.',
  },
  {
    id: 'sensitive-approval',
    category: 'agent',
    ...faOf('sensitive-approval'),
    en: 'R1+ actions always need user approval (R3 needs the app name typed); everything is audited.',
  },
];

export function limitsByCategory(): Array<{ category: LimitCategory; titleFa: string; items: LimitItem[] }> {
  const order = Object.keys(CATEGORY_FA) as LimitCategory[];
  return order.map((category) => ({ category, titleFa: CATEGORY_FA[category], items: LIMITS.filter((l) => l.category === category) }));
}

export function findLimit(id: string): LimitItem | undefined {
  return LIMITS.find((l) => l.id === id);
}

/** Compact form for the `get_limits` tool. */
export function limitsForLlm() {
  return {
    limits: LIMITS.map((l) => ({ id: l.id, category: l.category, limit: l.en })),
    note: 'Open API questions are tracked in docs/OPEN_QUESTIONS.md; behaviour marked unknown is handled conservatively.',
  };
}
