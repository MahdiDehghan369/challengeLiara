import OpenAI from 'openai';
import type { Logger } from 'pino';
import { redactText } from '../safety/redact.js';
import { LlmError } from '../shared/errors.js';
import { logger as rootLogger } from '../shared/logger.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { ModelRouter } from './router.js';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient, LlmUsage, ToolCall } from './types.js';

export const LLM_TIMEOUT_MS = 60_000;
export const LLM_MAX_RETRIES = 2;

export interface OpenAiLlmOptions {
  apiKey: string;
  router: ModelRouter;
  /** Usage sink (SessionBudget, T2.6). Throwing stops the agent. */
  budget?: { recordLlm(usage: Partial<LlmUsage>): void };
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Injected fetch (tests). */
  fetch?: typeof fetch;
  logger?: Logger;
}

type OaMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Everything sent to the model is redacted here as a last line of defence (AGENT_RULES §1.9). */
function toOpenAi(m: ChatMessage): OaMessage {
  switch (m.role) {
    case 'system':
    case 'user':
      return { role: m.role, content: redactText(m.content) };
    case 'tool':
      return { role: 'tool', tool_call_id: m.toolCallId, content: redactText(m.content) };
    case 'assistant':
      return {
        role: 'assistant',
        content: m.content === null ? null : redactText(m.content),
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: redactText(t.arguments) } })) }
          : {}),
      };
  }
}

function isRetryable(e: unknown): boolean {
  if (e instanceof OpenAI.APIConnectionError) return true; // includes timeouts
  if (e instanceof OpenAI.APIError) return e.status === 429 || (e.status !== undefined && e.status >= 500);
  return false;
}

function describe(e: unknown): string {
  if (e instanceof OpenAI.APIError) return `HTTP ${e.status ?? '?'}: ${redactText(e.message).slice(0, 200)}`;
  return redactText(e instanceof Error ? e.message : String(e)).slice(0, 200);
}

const ZERO: LlmUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** BoxAPI (OpenAI-compatible) client with per-role model routing, retries and fallback (T3.1). */
export class OpenAiLlm implements LlmClient {
  private readonly client: OpenAI;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: Logger;

  constructor(private readonly opts: OpenAiLlmOptions) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.router.baseUrl,
      timeout: opts.timeoutMs ?? LLM_TIMEOUT_MS,
      maxRetries: 0, // retries are ours: only 429/5xx, then fallback
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
    this.maxRetries = opts.maxRetries ?? LLM_MAX_RETRIES;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = (opts.logger ?? rootLogger).child({ mod: 'llm' });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const route = this.opts.router.pick(req.role);
    if (req.tools?.length && route.protocol === 'json') {
      throw new LlmError(`role ${req.role} uses the JSON tool protocol (OQ-26)`, {
        messageFa: fa.llm.toolsNeedJsonProtocol,
        details: { role: req.role, model: route.model },
      });
    }
    const failures: string[] = [];
    for (const model of this.opts.router.candidates(req.role)) {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const res = req.stream ? await this.streamOnce(model, req) : await this.once(model, req);
          this.opts.budget?.recordLlm(res.usage);
          return res;
        } catch (e) {
          if (e instanceof LlmError || (e instanceof Error && e.name === 'BudgetExceededError')) throw e;
          failures.push(`${model}#${attempt + 1}: ${describe(e)}`);
          this.log.debug({ model, attempt, err: describe(e) }, 'llm call failed');
          if (!isRetryable(e) || attempt === this.maxRetries) break; // → next model
          await this.sleep(500 * 2 ** attempt);
        }
      }
    }
    throw new LlmError(`all models failed for role ${req.role}`, {
      messageFa: fa.llm.allModelsFailed,
      details: { role: req.role, failures },
      retryable: true,
    });
  }

  private params(model: string, req: ChatRequest) {
    return {
      model,
      messages: req.messages.map(toOpenAi),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } })),
            tool_choice: 'auto' as const,
          }
        : {}),
      ...(req.json ? { response_format: { type: 'json_object' as const } } : {}),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    };
  }

  private async once(model: string, req: ChatRequest): Promise<ChatResponse> {
    const r = await this.client.chat.completions.create(this.params(model, req), req.signal ? { signal: req.signal } : undefined);
    const choice = r.choices[0];
    const toolCalls: ToolCall[] = (choice?.message.tool_calls ?? [])
      .filter((t) => t.type === 'function')
      .map((t) => ({ id: t.id, name: t.function.name, arguments: t.function.arguments }));
    return {
      content: choice?.message.content ?? null,
      toolCalls,
      model: r.model ?? model,
      usage: r.usage
        ? { promptTokens: r.usage.prompt_tokens, completionTokens: r.usage.completion_tokens, totalTokens: r.usage.total_tokens }
        : ZERO,
      finishReason: choice?.finish_reason ?? undefined,
    };
  }

  private async streamOnce(model: string, req: ChatRequest): Promise<ChatResponse> {
    const stream = await this.client.chat.completions.create(
      { ...this.params(model, req), stream: true, stream_options: { include_usage: true } },
      req.signal ? { signal: req.signal } : undefined,
    );
    let content = '';
    let usage = ZERO;
    let finishReason: string | undefined;
    const calls = new Map<number, ToolCall>();
    for await (const chunk of stream) {
      const c = chunk.choices[0];
      const delta = c?.delta;
      if (delta?.content) {
        content += delta.content;
        req.onDelta?.(delta.content);
      }
      for (const t of delta?.tool_calls ?? []) {
        const cur = calls.get(t.index) ?? { id: '', name: '', arguments: '' };
        calls.set(t.index, {
          id: t.id ?? cur.id,
          name: cur.name + (t.function?.name ?? ''),
          arguments: cur.arguments + (t.function?.arguments ?? ''),
        });
      }
      if (c?.finish_reason) finishReason = c.finish_reason;
      if (chunk.usage) {
        usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens };
      }
    }
    return { content: content || null, toolCalls: [...calls.values()], model, usage, finishReason };
  }
}
