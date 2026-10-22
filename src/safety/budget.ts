import { BudgetExceededError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { planHash } from './approval.js';

/**
 * Session guards (T2.6): Liara request rate, LLM request/token budget, and a loop breaker.
 * Soft limit → one warning per crossing; hard limit → BudgetExceededError, which stops the agent loop.
 */

export interface BudgetLimits {
  /** TODO(OQ-24): Liara's real rate limit is unknown (BEHAVIOR §11); 60/min is the task default. */
  liaraPerMinuteSoft: number;
  liaraPerMinuteHard: number;
  llmRequestsSoft: number;
  llmRequestsHard: number;
  llmTokensSoft: number;
  llmTokensHard: number;
}

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  liaraPerMinuteSoft: 60,
  liaraPerMinuteHard: 120,
  llmRequestsSoft: 60,
  llmRequestsHard: 120,
  llmTokensSoft: 300_000,
  llmTokensHard: 600_000,
};

export type BudgetCounter = 'liaraPerMinute' | 'llmRequests' | 'llmTokens';

export interface BudgetWarning {
  counter: BudgetCounter;
  value: number;
  limit: number;
  messageFa: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

const WINDOW_MS = 60_000;

export class SessionBudget {
  readonly limits: BudgetLimits;
  private readonly now: () => number;
  private readonly onWarn: (w: BudgetWarning) => void;
  private liaraTimes: number[] = [];
  private llmRequests = 0;
  private llmTokens = 0;
  private readonly warned = new Set<BudgetCounter>();

  constructor(
    limits: Partial<BudgetLimits> = {},
    opts: { now?: () => number; onWarn?: (w: BudgetWarning) => void } = {},
  ) {
    this.limits = { ...DEFAULT_BUDGET_LIMITS, ...limits };
    this.now = opts.now ?? Date.now;
    this.onWarn = opts.onWarn ?? (() => {});
  }

  private check(counter: BudgetCounter, value: number, soft: number, hard: number): void {
    const what = fa.budget.counters[counter];
    if (value > hard) {
      throw new BudgetExceededError(`${counter} ${value} > hard limit ${hard}`, {
        messageFa: fa.budget.hard(what, value, hard),
        details: { counter, value, limit: hard },
      });
    }
    if (value > soft) {
      if (!this.warned.has(counter)) {
        this.warned.add(counter);
        this.onWarn({ counter, value, limit: soft, messageFa: fa.budget.soft(what, value, soft) });
      }
    } else if (counter === 'liaraPerMinute') {
      // the rate window slides: warn again after it drops back under the soft limit
      this.warned.delete(counter);
    }
  }

  /** Call before every Liara request (wire it to `LiaraHttp`'s `onRequest`). */
  recordLiaraRequest(): void {
    const t = this.now();
    this.liaraTimes = this.liaraTimes.filter((x) => t - x < WINDOW_MS);
    this.liaraTimes.push(t);
    this.check('liaraPerMinute', this.liaraTimes.length, this.limits.liaraPerMinuteSoft, this.limits.liaraPerMinuteHard);
  }

  /** Call after every LLM response. */
  recordLlm(usage: LlmUsage = {}): void {
    this.llmRequests += 1;
    this.llmTokens += usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    this.check('llmRequests', this.llmRequests, this.limits.llmRequestsSoft, this.limits.llmRequestsHard);
    this.check('llmTokens', this.llmTokens, this.limits.llmTokensSoft, this.limits.llmTokensHard);
  }

  snapshot(): { liaraLastMinute: number; llmRequests: number; llmTokens: number } {
    const t = this.now();
    return {
      liaraLastMinute: this.liaraTimes.filter((x) => t - x < WINDOW_MS).length,
      llmRequests: this.llmRequests,
      llmTokens: this.llmTokens,
    };
  }
}

export interface LoopBreakerOptions {
  /** Consecutive steps without progress before stopping. */
  maxStepsWithoutProgress?: number;
  /** Identical tool+params calls allowed; one more stops the loop. */
  maxIdenticalToolCalls?: number;
}

export interface LoopStep {
  tool?: string;
  params?: Record<string, unknown>;
  /** The step changed something or produced new information. */
  progress: boolean;
}

/** Stops runaway agent loops: N steps without progress, or the same tool+params more than K times. */
export class LoopBreaker {
  private readonly maxNoProgress: number;
  private readonly maxIdentical: number;
  private noProgress = 0;
  private readonly calls = new Map<string, number>();

  constructor(opts: LoopBreakerOptions = {}) {
    this.maxNoProgress = opts.maxStepsWithoutProgress ?? 8;
    this.maxIdentical = opts.maxIdenticalToolCalls ?? 3;
  }

  record(step: LoopStep): void {
    if (step.tool) {
      const key = planHash({ toolName: step.tool, target: {}, params: step.params ?? {} });
      const n = (this.calls.get(key) ?? 0) + 1;
      this.calls.set(key, n);
      if (n > this.maxIdentical) {
        throw new BudgetExceededError(`tool ${step.tool} repeated ${n} times with identical params`, {
          messageFa: fa.budget.repeatedTool(step.tool, n),
          details: { reason: 'repeated_tool', tool: step.tool, count: n },
        });
      }
    }
    this.noProgress = step.progress ? 0 : this.noProgress + 1;
    if (this.noProgress >= this.maxNoProgress) {
      throw new BudgetExceededError(`${this.noProgress} steps without progress`, {
        messageFa: fa.budget.noProgress(this.noProgress),
        details: { reason: 'no_progress', steps: this.noProgress },
      });
    }
  }

  reset(): void {
    this.noProgress = 0;
    this.calls.clear();
  }
}
