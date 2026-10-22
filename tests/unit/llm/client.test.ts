import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseModelsConfig } from '../../../src/config/models.js';
import { createLlm, MockLlm, ModelRouter, OpenAiLlm, type ChatRequest } from '../../../src/llm/index.js';
import { SessionBudget } from '../../../src/safety/budget.js';
import { BudgetExceededError, LlmError } from '../../../src/shared/errors.js';

const models = parseModelsConfig({
  baseUrl: 'https://ai.boxapi.test/ai/v1',
  roles: {
    chat: { model: 'chat-a', fallbackProtocol: 'native-tools', fallbacks: ['chat-b'] },
    reasoning: { model: 'reason-a', fallbackProtocol: 'json', fallbacks: [] },
    code: { model: 'code-a', fallbackProtocol: 'json', fallbacks: [] },
    cheap: { model: 'cheap-a', fallbackProtocol: 'native-tools', fallbacks: [] },
  },
});
const router = new ModelRouter(models);

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

function completion(model: string, message: Record<string, unknown>, usage = { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }) {
  return { id: 'cmpl-1', object: 'chat.completion', created: 1, model, choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage };
}

/** Fake BoxAPI: `script(model, attempt)` decides each response. */
function fakeFetch(script: (body: Record<string, unknown>, n: number) => Response) {
  const sent: Sent[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    sent.push({ url, body });
    return script(body, sent.length);
  }) as typeof fetch;
  return { f, sent };
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const llm = (f: typeof fetch, budget?: SessionBudget) =>
  new OpenAiLlm({ apiKey: 'test-key', router, fetch: f, sleep: async () => {}, ...(budget ? { budget } : {}) });
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({ role: 'chat', messages: [{ role: 'user', content: 'سلام' }], ...over });

describe('OpenAiLlm', () => {
  it('routes the role to its model, returns content + usage, records usage in the budget', async () => {
    const { f, sent } = fakeFetch((b) => json(completion(String(b.model), { content: 'درود' })));
    const budget = new SessionBudget();
    const r = await llm(f, budget).chat(req());
    expect(r).toMatchObject({ content: 'درود', model: 'chat-a', usage: { totalTokens: 10 }, toolCalls: [] });
    expect(sent[0]?.url).toBe('https://ai.boxapi.test/ai/v1/chat/completions');
    expect(budget.snapshot()).toMatchObject({ llmRequests: 1, llmTokens: 10 });
  });

  it('redacts everything it sends', async () => {
    const { f, sent } = fakeFetch((b) => json(completion(String(b.model), { content: 'ok' })));
    await llm(f).chat(req({ messages: [{ role: 'system', content: 'x' }, { role: 'tool', toolCallId: 't1', content: 'DATABASE_URL=postgres://u:hunter2pw@db:5432/x' }] }));
    expect(JSON.stringify(sent[0]?.body)).not.toContain('hunter2pw');
  });

  it('retries 429/5xx twice on the same model, then falls back to the next', async () => {
    const { f, sent } = fakeFetch((b, n) => (n <= 3 ? json({ error: { message: 'busy' } }, n === 2 ? 503 : 429) : json(completion(String(b.model), { content: 'ok' }))));
    const r = await llm(f).chat(req());
    expect(sent.map((s) => s.body.model)).toEqual(['chat-a', 'chat-a', 'chat-a', 'chat-b']);
    expect(r.model).toBe('chat-b');
  });

  it('a 400 (e.g. unsupported model) falls back immediately', async () => {
    const { f, sent } = fakeFetch((b) => (b.model === 'chat-a' ? json({ error: { message: 'operation is unsupported' } }, 400) : json(completion('chat-b', { content: 'ok' }))));
    expect((await llm(f).chat(req())).model).toBe('chat-b');
    expect(sent.map((s) => s.body.model)).toEqual(['chat-a', 'chat-b']);
  });

  it('all models failing → LlmError with Persian message and per-model failures', async () => {
    const { f } = fakeFetch(() => json({ error: { message: 'nope' } }, 400));
    const e = (await llm(f).chat(req()).catch((x: unknown) => x)) as LlmError;
    expect(e).toBeInstanceOf(LlmError);
    expect(e.messageFa).toContain('مدل');
    expect((e.details.failures as string[]).length).toBe(2);
  });

  it('native tools: sends tools, parses tool calls', async () => {
    const { f, sent } = fakeFetch((b) =>
      json(completion(String(b.model), { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_logs', arguments: '{"app":"shop"}' } }] })),
    );
    const r = await llm(f).chat(req({ tools: [{ name: 'get_logs', description: 'logs', parameters: { type: 'object', properties: {} } }] }));
    expect((sent[0]?.body.tools as unknown[]).length).toBe(1);
    expect(r.toolCalls).toEqual([{ id: 'c1', name: 'get_logs', arguments: '{"app":"shop"}' }]);
  });

  it('a json-protocol role refuses native tools without calling the network (OQ-26)', async () => {
    const { f, sent } = fakeFetch(() => json({}));
    await expect(llm(f).chat(req({ role: 'reasoning', tools: [{ name: 't', description: 'd', parameters: {} }] }))).rejects.toBeInstanceOf(LlmError);
    expect(sent).toHaveLength(0);
  });

  it('json mode sets response_format', async () => {
    const { f, sent } = fakeFetch((b) => json(completion(String(b.model), { content: '{"a":1}' })));
    await llm(f).chat(req({ json: true }));
    expect(sent[0]?.body.response_format).toEqual({ type: 'json_object' });
  });

  it('streaming: deltas, tool-call fragments and usage', async () => {
    const chunks = [
      { choices: [{ index: 0, delta: { content: 'سل' } }] },
      { choices: [{ index: 0, delta: { content: 'ام' } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'get_', arguments: '{"a"' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'logs', arguments: ':1}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } },
    ];
    const sse = chunks.map((c) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'chat-a', ...c })}\n\n`).join('') + 'data: [DONE]\n\n';
    const { f, sent } = fakeFetch(() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const deltas: string[] = [];
    const r = await llm(f).chat(req({ stream: true, onDelta: (d) => deltas.push(d) }));
    expect(sent[0]?.body.stream).toBe(true);
    expect(deltas.join('')).toBe('سلام');
    expect(r).toMatchObject({ content: 'سلام', toolCalls: [{ id: 'c9', name: 'get_logs', arguments: '{"a":1}' }], usage: { totalTokens: 6 }, finishReason: 'tool_calls' });
  });

  it('budget hard limit stops immediately (no fallback)', async () => {
    const { f, sent } = fakeFetch((b) => json(completion(String(b.model), { content: 'x' }, { prompt_tokens: 900, completion_tokens: 900, total_tokens: 1800 })));
    const budget = new SessionBudget({ llmTokensSoft: 100, llmTokensHard: 1000 });
    await expect(llm(f, budget).chat(req())).rejects.toBeInstanceOf(BudgetExceededError);
    expect(sent).toHaveLength(1);
  });
});

describe('createLlm / MockLlm', () => {
  afterEach(() => vi.restoreAllMocks());

  it('LLM_MODE=mock sends no network request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const c = createLlm({ llm: { mode: 'mock', apiKey: undefined } }, { mockRules: [{ when: 'logs', reply: { content: 'ok' } }] });
    expect(c).toBeInstanceOf(MockLlm);
    await c.chat({ role: 'chat', messages: [{ role: 'user', content: 'show logs' }] });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rules: substring, regex, predicate, times, tool calls; fallback error', async () => {
    const m = new MockLlm([{ when: 'restart', reply: { toolCalls: [{ name: 'restart_app', arguments: { app: 'shop' } }] }, times: 1 }], { fallback: 'error' })
      .on(/خطا|error/, { content: 'تحلیل' })
      .on((r) => r.role === 'cheap', { content: 'cheap' });
    const a = await m.chat({ role: 'chat', messages: [{ role: 'user', content: 'please restart' }] });
    expect(a.toolCalls[0]).toMatchObject({ name: 'restart_app', arguments: '{"app":"shop"}' });
    expect(a.finishReason).toBe('tool_calls');
    // `times: 1` used up → next rule set; nothing matches → error
    await expect(m.chat({ role: 'chat', messages: [{ role: 'user', content: 'please restart' }] })).rejects.toBeInstanceOf(LlmError);
    expect((await m.chat({ role: 'chat', messages: [{ role: 'tool', toolCallId: 'x', content: 'error in logs' }] })).content).toBe('تحلیل');
    expect((await m.chat({ role: 'cheap', messages: [{ role: 'user', content: 'x' }] })).content).toBe('cheap');
    expect(m.calls).toHaveLength(4);
  });
});
