import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Session } from '../../src/agent/session.js';
import type { PipelineEvent } from '../../src/deploy/pipeline-engine.js';
import { createLiaraClient, type LiaraClient } from '../../src/liara/index.js';
import { MockLlm, type ChatRequest, type LlmClient } from '../../src/llm/index.js';
import { ScriptedApprover } from '../../src/safety/approval.js';
import { AuditLog } from '../../src/safety/audit.js';
import { DEFAULT_POLICY } from '../../src/safety/policy.js';
import { LlmError } from '../../src/shared/errors.js';
import { runChat, toolLine, type ChatIo } from '../../src/ui/cli/chat.js';
import { buildCliRegistry, type CliServices } from '../../src/ui/cli/runtime.js';
import { ScriptedUi, type ScriptedAnswer } from '../../src/ui/cli/scripted-ui.js';

const root = mkdtempSync(join(tmpdir(), 'siavash-chat-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let open: LiaraClient[] = [];
afterEach(async () => {
  await Promise.all(open.map((c) => c.mock!.servers.close()));
  open = [];
});

/** Scripted terminal: lines in, writes recorded; `interruptAfter` fires Ctrl+C once a turn is running. */
function scriptedIo(lines: string[], opts: { interruptAfterMs?: number } = {}) {
  const writes: string[] = [];
  const io: ChatIo = {
    read: async () => lines.shift(),
    write: (t) => writes.push(t),
    onInterrupt: (h) => {
      const t = opts.interruptAfterMs === undefined ? undefined : setTimeout(h, opts.interruptAfterMs);
      return () => clearTimeout(t);
    },
  };
  return { io, writes };
}

function world(llm: LlmClient, answers: ScriptedAnswer[] = []) {
  const dataDir = join(mkdtempSync(join(root, 'd-')), 'data');
  const config = { liara: { token: undefined, teamId: undefined, mode: 'mock' as const }, llm: { apiKey: undefined, mode: 'mock' as const }, dataDir, logLevel: 'silent' as const, deployMode: 'cli' as const };
  const liara = createLiaraClient(config, { mockOptions: { asyncDelayMs: 1 } });
  open.push(liara);
  const app = liara.mock!.state.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
  liara.mock!.state.createRelease(app, { sourceID: liara.mock!.state.addSource(app, 1024), port: 3000, type: 'node' }, 'api');
  const ui = new ScriptedUi(answers);
  const urlFor = (n: string) => liara.mock!.servers.urlFor(n);
  const pipelineEvents: { sink?: (e: PipelineEvent) => void } = {};
  const services: CliServices = {
    config,
    liara,
    llm,
    registry: buildCliRegistry({ config, liara, ui, urlFor, onPipelineEvent: (e) => pipelineEvents.sink?.(e) }),
    audit: new AuditLog(dataDir),
    policy: DEFAULT_POLICY,
    urlFor,
    pipelineEvents,
  };
  const approver = new ScriptedApprover(['approved']);
  const session = Session.create(dataDir);
  const chat = (io: ChatIo, extra: { verbose?: boolean } = {}) =>
    runChat({ services, ui, approver, session, io, cwd: join(root, 'no-such-project'), ...extra });
  return { liara, mock: liara.mock!.state, ui, approver, chat, session };
}

/** LLM: user message → one tool call; tool result → a short answer. */
function agentLlm(tool: string, args: Record<string, unknown>, answer: string): MockLlm {
  const last = (req: ChatRequest) => req.messages[req.messages.length - 1];
  return new MockLlm().on((req) => last(req)?.role === 'tool', { content: answer }).on((req) => last(req)?.role === 'user', { toolCalls: [{ name: tool, arguments: args }] });
}

describe('interactive chat (T9.6)', { timeout: 60_000 }, () => {
  it('welcome + 3 suggestions; built-ins; a status question runs a tool shown as one line, never raw output', async () => {
    const w = world(agentLlm('app_overview', { app: 'shop' }, 'اپ shop سالم است و پاسخ می‌دهد.'));
    const { io, writes } = scriptedIo(['/help', '/app shop', 'وضعیت سایتم چطوره؟', '/history', '/exit']);
    await w.chat(io);
    const all = writes.join('\n');
    expect(writes[0]).toContain('پروژه‌مو دیپلوی کن');
    expect(writes[0]).toContain('سایتم کند شده');
    expect(all).toContain('/dry-run on|off');
    expect(all).toContain('اپ پیش‌فرض: shop');
    expect(all).toContain(toolLine('app_overview'));
    expect(all).toContain('اپ shop سالم است');
    expect(all).toContain('1. وضعیت سایتم چطوره؟');
    // the raw tool result (overview JSON) never reaches the user
    expect(all).not.toMatch(/"partial"|"failed":\[|\{"app"/);
    expect(w.session.currentApp).toBe('shop');
  });

  it('--verbose shows tool arguments', async () => {
    const w = world(agentLlm('get_logs', { app: 'shop' }, 'لاگ‌ها مشکلی ندارند.'));
    const { io, writes } = scriptedIo(['لاگ‌های shop رو نشونم بده', '/exit']);
    await w.chat(io, { verbose: true });
    expect(writes.join('\n')).toContain('"app":"shop"');
  });

  it('/dry-run on: a restart is only shown, nothing changes', async () => {
    const w = world(agentLlm('restart_app', { app: 'shop' }, 'در حالت آزمایشی فقط نشان دادم.'));
    await w.mock.settle();
    const before = w.mock.apps.get('shop')!.events.length;
    const { io } = scriptedIo(['/dry-run on', 'اپ shop رو ری‌استارت کن', '/exit']);
    await w.chat(io);
    await w.mock.settle();
    expect(w.mock.apps.get('shop')!.events.length).toBe(before);
    expect(w.approver.seen).toEqual([]);
  });

  it('diagnose runs the doctor pipeline directly (no LLM call for the intent)', async () => {
    const llm = new MockLlm();
    const w = world(llm, [{ match: /کدام راهکار/, answer: 'skip' }]);
    w.mock.injectScenario('shop', 'missing-env');
    const { io, writes } = scriptedIo(['/app shop', 'سایتم خطا میده', '/exit']);
    await w.chat(io);
    expect(writes.join('\n')).toContain(toolLine('diagnose_app'));
    // the intent came from the rules: no intent-classification call (the doctor's own log analysis may use the LLM)
    expect(llm.calls.filter((c) => c.messages.some((m) => typeof m.content === 'string' && m.content.includes('You classify one message')))).toEqual([]);
    expect(w.ui.notes.some((n) => /علت محتمل/.test(n.body))).toBe(true);
  });

  it('deploy runs the deploy pipeline directly with the live step list', async () => {
    const w = world(new MockLlm());
    const { io, writes } = scriptedIo(['پروژه‌مو دیپلوی کن', '/exit']);
    await w.chat(io);
    const all = writes.join('\n');
    expect(all).toContain(toolLine('deploy_project'));
    expect(all).toMatch(/❌/); // the project folder does not exist → preflight stops
  });

  it('Ctrl+C cancels the running turn safely and the chat continues', async () => {
    const hanging: LlmClient = {
      chat: (req) =>
        new Promise((_resolve, reject) => {
          const fail = () => reject(new LlmError('aborted', { messageFa: 'لغو' }));
          if (req.signal?.aborted) fail();
          else req.signal?.addEventListener('abort', fail);
        }),
    } as LlmClient;
    const w = world(hanging);
    const { io, writes } = scriptedIo(['یه سوال کلی دارم', '/app shop', '/exit'], { interruptAfterMs: 30 });
    await w.chat(io);
    const all = writes.join('\n');
    expect(all).toContain('کار جاری لغو شد.');
    expect(all).toContain('اپ پیش‌فرض: shop');
    expect(all).toContain('خدانگهدار');
  });
});
