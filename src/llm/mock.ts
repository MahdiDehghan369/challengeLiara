import { LlmError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { ChatMessage, ChatRequest, ChatResponse, LlmClient, LlmUsage, ToolCall } from './types.js';

/**
 * Scriptable LLM for tests and `LLM_MODE=mock` (T3.1). Rules are checked in order:
 * "if the request matches X → reply with Y (text and/or tool calls)". No network, ever.
 */

export type MockReply =
  | { content: string; toolCalls?: Array<{ name: string; arguments: Record<string, unknown> | string }> }
  | { toolCalls: Array<{ name: string; arguments: Record<string, unknown> | string }>; content?: string }
  | ((req: ChatRequest) => Partial<ChatResponse>);

export interface MockRule {
  /** Substring / regex matched against the last user or tool message, or a predicate on the request. */
  when: string | RegExp | ((req: ChatRequest) => boolean);
  reply: MockReply;
  /** Use at most N times (default unlimited). */
  times?: number;
}

const USAGE: LlmUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };

function lastText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as ChatMessage;
    if (m.role === 'user' || m.role === 'tool') return m.content;
  }
  return '';
}

export class MockLlm implements LlmClient {
  readonly calls: ChatRequest[] = [];
  private readonly rules: Array<MockRule & { used: number }>;
  private seq = 0;

  constructor(
    rules: MockRule[] = [],
    private readonly opts: { fallback?: MockReply | 'error'; budget?: { recordLlm(u: Partial<LlmUsage>): void } } = {},
  ) {
    this.rules = rules.map((r) => ({ ...r, used: 0 }));
  }

  /** Adds a rule at the end. */
  on(when: MockRule['when'], reply: MockReply, times?: number): this {
    this.rules.push({ when, reply, used: 0, ...(times !== undefined ? { times } : {}) });
    return this;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls.push(req);
    const text = lastText(req.messages);
    const rule = this.rules.find((r) => {
      if (r.times !== undefined && r.used >= r.times) return false;
      if (typeof r.when === 'function') return r.when(req);
      return typeof r.when === 'string' ? text.includes(r.when) : r.when.test(text);
    });
    const reply = rule?.reply ?? this.opts.fallback ?? { content: 'mock reply' };
    if (rule) rule.used++;
    if (reply === 'error') {
      throw new LlmError('MockLlm: no rule matched', { messageFa: fa.llm.noMockRule, details: { text: text.slice(0, 200) } });
    }
    const res = this.build(req, reply);
    this.opts.budget?.recordLlm(res.usage);
    req.onDelta?.(res.content ?? '');
    return res;
  }

  private build(req: ChatRequest, reply: MockReply): ChatResponse {
    if (typeof reply === 'function') {
      const r = reply(req);
      return { content: r.content ?? null, toolCalls: r.toolCalls ?? [], model: r.model ?? 'mock', usage: r.usage ?? USAGE, finishReason: r.finishReason ?? 'stop' };
    }
    const toolCalls: ToolCall[] = (reply.toolCalls ?? []).map((t) => ({
      id: `call_mock_${++this.seq}`,
      name: t.name,
      arguments: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments),
    }));
    return {
      content: reply.content ?? null,
      toolCalls,
      model: 'mock',
      usage: USAGE,
      finishReason: toolCalls.length ? 'tool_calls' : 'stop',
    };
  }
}
