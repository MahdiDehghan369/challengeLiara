import { describe, expect, it } from 'vitest';
import { encodeHistory, MockLlm, parseJsonReply, ToolProtocolLlm, type ChatRequest, type ToolDef } from '../../../src/llm/index.js';
import { LlmError } from '../../../src/shared/errors.js';

const TOOLS = ['get_logs', 'list_apps'];
const BOM = String.fromCharCode(0xfeff);
const LQ = String.fromCharCode(0x201c);
const RQ = String.fromCharCode(0x201d);

describe('parseJsonReply — malformed model output', () => {
  const action = { ok: true, kind: 'action', tool: 'get_logs', args: { app: 'shop' } };
  it.each([
    ['fenced ```json block', '```json\n{"thought":"x","action":{"tool":"get_logs","args":{"app":"shop"}}}\n```', action],
    ['prose before and after', 'Sure! Here you go: {"action":{"tool":"get_logs","args":{"app":"shop"}}} hope this helps', action],
    ['trailing commas', '{"action":{"tool":"get_logs","args":{"app":"shop",},},}', action],
    ['args as a JSON string', '{"action":{"tool":"get_logs","args":"{\\"app\\":\\"shop\\"}"}}', action],
    ['braces inside strings', '{"thought":"use {braces} and \\"quotes\\"","action":{"tool":"get_logs","args":{"app":"shop"}}}', action],
    ['Python literals', '{"action":{"tool":"list_apps","args":{"fresh": True, "x": None}}}', { ok: true, kind: 'action', tool: 'list_apps', args: { fresh: true, x: null } }],
    ['smart quotes', `{${LQ}final${RQ}: ${LQ}done${RQ}}`, { ok: true, kind: 'final', final: 'done' }],
    ['BOM + whitespace', `${BOM}\n  {"final":"تمام شد"}  \n`, { ok: true, kind: 'final', final: 'تمام شد' }],
    ['first object invalid, second valid', '{"oops": } then {"final":"ok"}', { ok: true, kind: 'final', final: 'ok' }],
    ['"name"/"arguments" instead of "tool"/"args"', '{"action":{"name":"get_logs","arguments":{"app":"shop"}}}', action],
    ['missing args → {}', '{"action":{"tool":"list_apps"}}', { ok: true, kind: 'action', tool: 'list_apps', args: {} }],
    ['unknown tool is rejected', '{"action":{"tool":"rm_rf","args":{}}}', { ok: false }],
    ['no JSON at all', 'I think you should restart the app.', { ok: false }],
    ['neither action nor final', '{"thought":"hmm"}', { ok: false }],
  ])('%s', (_label, text, expected) => {
    expect(parseJsonReply(text, TOOLS)).toMatchObject(expected);
  });
});

const tools: ToolDef[] = [
  { name: 'list_apps', description: 'List apps', parameters: { type: 'object', properties: {} } },
  { name: 'get_logs', description: 'Get logs', parameters: { type: 'object', properties: { app: { type: 'string' } } } },
];
const jsonRole = (req: ChatRequest) => (req.role === 'reasoning' ? 'json' : 'native-tools') as 'json' | 'native-tools';
const wrap = (inner: MockLlm) => new ToolProtocolLlm(inner, { protocolFor: (role) => jsonRole({ role, messages: [] }) });

describe('ToolProtocolLlm', () => {
  it('json role: injects tools + format, requests JSON, returns native-shaped tool calls', async () => {
    const inner = new MockLlm().on(() => true, { content: '```json\n{"thought":"check","action":{"tool":"list_apps","args":{}}}\n```' });
    const r = await wrap(inner).chat({ role: 'reasoning', messages: [{ role: 'user', content: 'apps?' }], tools });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]).toMatchObject({ name: 'list_apps', arguments: '{}' });
    expect(r.finishReason).toBe('tool_calls');
    const sent = inner.calls[0] as ChatRequest;
    expect(sent.tools).toBeUndefined();
    expect(sent.json).toBe(true);
    expect(sent.messages[0]).toMatchObject({ role: 'system' });
    expect((sent.messages[0] as { content: string }).content).toContain('get_logs');
  });

  it('final answer → content, no tool calls', async () => {
    const inner = new MockLlm().on(() => true, { content: '{"final":"شما ۲ اپ دارید"}' });
    const r = await wrap(inner).chat({ role: 'reasoning', messages: [{ role: 'user', content: 'x' }], tools });
    expect(r).toMatchObject({ content: 'شما ۲ اپ دارید', toolCalls: [], finishReason: 'stop' });
  });

  it('retries once with a correction, then fails with a Persian LlmError', async () => {
    const recovering = new MockLlm().on(() => true, { content: 'not json' }, 1).on(() => true, { content: '{"final":"ok"}' });
    expect((await wrap(recovering).chat({ role: 'reasoning', messages: [{ role: 'user', content: 'x' }], tools })).content).toBe('ok');
    expect((recovering.calls[1]?.messages.at(-1) as { content: string }).content).toContain('not valid');

    const broken = new MockLlm().on(() => true, { content: 'still not json' });
    const e = (await wrap(broken)
      .chat({ role: 'reasoning', messages: [{ role: 'user', content: 'x' }], tools })
      .catch((x: unknown) => x)) as LlmError;
    expect(e).toBeInstanceOf(LlmError);
    expect(e.messageFa).toContain('JSON');
    expect(broken.calls).toHaveLength(2);
  });

  it('native role and tool-less requests pass straight through', async () => {
    const inner = new MockLlm().on(() => true, { toolCalls: [{ name: 'list_apps', arguments: {} }] });
    const r = await wrap(inner).chat({ role: 'chat', messages: [{ role: 'user', content: 'x' }], tools });
    expect(r.toolCalls[0]?.name).toBe('list_apps');
    expect(inner.calls[0]?.tools).toBe(tools);
  });

  it('tool-call history is re-encoded for json models', () => {
    const out = encodeHistory([
      { role: 'assistant', content: 'checking', toolCalls: [{ id: 'c1', name: 'get_logs', arguments: '{"app":"shop"}' }] },
      { role: 'tool', toolCallId: 'c1', content: 'ERROR boom' },
    ]);
    expect(out[0]).toEqual({ role: 'assistant', content: '{"thought":"checking","action":{"tool":"get_logs","args":{"app":"shop"}}}' });
    expect(out[1]).toEqual({ role: 'user', content: 'TOOL_RESULT (c1):\nERROR boom' });
  });
});
