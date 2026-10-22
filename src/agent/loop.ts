import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LiaraClient } from '../liara/index.js';
import type { ChatMessage, LlmClient, ToolCall } from '../llm/index.js';
import type { ApprovalContext, ApprovalDecision, Approver, AuditSink } from '../safety/approval.js';
import { LoopBreaker } from '../safety/budget.js';
import type { Policy } from '../safety/policy.js';
import type { ActionPlan } from '../safety/risk.js';
import { BudgetExceededError, isSiavashError } from '../shared/errors.js';
import type { ToolContext, ToolRegistry } from '../tools/index.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { Session } from './session.js';

/** Agent loop (T3.6): user → LLM (with tools) → registry → results → … → final answer. */

export type AgentEvent =
  | { type: 'thinking'; step: number }
  | { type: 'tool_start'; tool: string; args: unknown }
  | { type: 'tool_end'; tool: string; ok: boolean; status: string; ms: number }
  | { type: 'approval_needed'; plan: ActionPlan }
  | { type: 'human_step'; textFa: string }
  | { type: 'message'; text: string }
  | { type: 'error'; messageFa: string; code: string };

export interface AgentDeps {
  llm: LlmClient;
  registry: ToolRegistry;
  liara: LiaraClient;
  approver: Approver;
  session: Session;
  emit?: (e: AgentEvent) => void;
  audit?: AuditSink;
  policy?: Policy;
  headless?: boolean;
  dryRun?: boolean;
  maxSteps?: number;
  breaker?: LoopBreaker;
  /** Override the system prompt (tests). */
  systemPrompt?: string;
  /** Persist the session after the turn (default true). */
  persist?: boolean;
  signal?: AbortSignal;
}

export interface AgentTurnResult {
  finalText: string;
  steps: number;
  stopped?: 'max_steps' | 'budget' | 'error';
}

export const DEFAULT_MAX_STEPS = 12;

const PROMPT_PATH = fileURLToPath(new URL('../llm/prompts/system.fa.md', import.meta.url));
let promptTemplate: string | undefined;

/** The Persian system prompt with `{{app}}` / `{{date}}` filled in. */
export function systemPrompt(vars: { app?: string; date?: string } = {}): string {
  promptTemplate ??= readFileSync(PROMPT_PATH, 'utf8');
  return promptTemplate
    .replace('{{app}}', vars.app ?? '—')
    .replace('{{date}}', vars.date ?? new Date().toISOString().slice(0, 10));
}

/** Emits `approval_needed` before the real approver shows its card. */
function announcingApprover(inner: Approver, emit: (e: AgentEvent) => void): Approver {
  return {
    request(plan: ActionPlan, ctx?: ApprovalContext): Promise<ApprovalDecision> {
      emit({ type: 'approval_needed', plan });
      return inner.request(plan, ctx);
    },
  };
}

function parseArgs(call: ToolCall): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(call.arguments || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return { ok: true, args: v as Record<string, unknown> };
    return { ok: false, error: 'arguments must be a JSON object' };
  } catch (e) {
    return { ok: false, error: `arguments are not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function runAgentTurn(deps: AgentDeps, userText: string): Promise<AgentTurnResult> {
  const emit = deps.emit ?? (() => {});
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const breaker = deps.breaker ?? new LoopBreaker();
  const session = deps.session;
  const tools = deps.registry.toOpenAiTools();
  const ctx: ToolContext = {
    liara: deps.liara,
    llm: deps.llm,
    approver: announcingApprover(deps.approver, emit),
    session: session.approvals,
    sessionId: session.id,
    actor: 'agent',
    ui: { emit: (e) => emit(e) },
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.policy ? { policy: deps.policy } : {}),
    ...(deps.headless ? { headless: true } : {}),
    ...(deps.dryRun ? { dryRun: true } : {}),
    ...(deps.signal ? { signal: deps.signal } : {}),
  };
  const finish = (r: AgentTurnResult): AgentTurnResult => {
    if (deps.persist !== false) session.save();
    return r;
  };
  const stop = (code: string, messageFa: string, stopped: AgentTurnResult['stopped'], steps: number) => {
    emit({ type: 'error', code, messageFa });
    return finish({ finalText: messageFa, steps, ...(stopped ? { stopped } : {}) });
  };

  session.addMessage({ role: 'user', content: userText });

  for (let step = 1; step <= maxSteps; step++) {
    emit({ type: 'thinking', step });
    let res;
    try {
      await session.compact(deps.llm);
      const system = deps.systemPrompt ?? systemPrompt(session.currentApp ? { app: session.currentApp } : {});
      const messages: ChatMessage[] = [{ role: 'system', content: system }, ...session.contextMessages()];
      res = await deps.llm.chat({ role: 'chat', messages, tools, ...(deps.signal ? { signal: deps.signal } : {}) });
    } catch (e) {
      if (e instanceof BudgetExceededError) return stop(e.code, e.messageFa, 'budget', step);
      return stop(isSiavashError(e) ? e.code : 'LLM_ERROR', isSiavashError(e) ? e.messageFa : fa.errors.llm, 'error', step);
    }

    if (res.toolCalls.length === 0) {
      const text = res.content?.trim() || fa.agent.noAnswer;
      session.addMessage({ role: 'assistant', content: text });
      emit({ type: 'message', text });
      return finish({ finalText: text, steps: step });
    }

    session.addMessage({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      const parsed = parseArgs(call);
      if (!parsed.ok) {
        session.addMessage({ role: 'tool', toolCallId: call.id, content: JSON.stringify({ error: 'INVALID_ARGUMENTS', message: parsed.error }) });
        continue;
      }
      try {
        const r = await deps.registry.invoke(call.name, parsed.args, ctx);
        breaker.record({ tool: call.name, params: parsed.args, progress: r.ok });
        const human = r.ok ? (r.result as { humanStepFa?: unknown } | undefined)?.humanStepFa : undefined;
        if (typeof human === 'string') emit({ type: 'human_step', textFa: human });
        session.addMessage({ role: 'tool', toolCallId: call.id, content: r.forLlm });
      } catch (e) {
        if (e instanceof BudgetExceededError) return stop(e.code, e.messageFa, 'budget', step);
        throw e;
      }
    }
  }
  return stop('MAX_STEPS', fa.agent.maxSteps(maxSteps), 'max_steps', maxSteps);
}
