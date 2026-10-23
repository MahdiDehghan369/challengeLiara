import { createInterface } from 'node:readline/promises';
import { routeIntent } from '../../agent/intent.js';
import { runAgentTurn, type AgentEvent } from '../../agent/loop.js';
import type { Session } from '../../agent/session.js';
import type { Approver } from '../../safety/approval.js';
import { redactText } from '../../safety/redact.js';
import type { ToolContext } from '../../tools/types.js';
import { CANCELLED, type Prompter } from './approver.js';
import { fa } from './i18n/fa.js';
import { renderMode, StepsView } from './render/steps.js';
import type { CliServices } from './runtime.js';

/**
 * Interactive Persian chat (T9.6). Intent first (T3.7): deploy and diagnose run their pipelines
 * directly, everything else goes to the agent loop. Tools show up as one Persian line each — never raw
 * output (only with `verbose`). Ctrl+C cancels the running turn safely (the signal reaches the LLM and
 * the tools; nothing is cut off between a gate and its action).
 */

const ch = fa.chat;

export interface ChatIo {
  /** One line from the user; `undefined` at end of input. */
  read(prompt: string): Promise<string | undefined>;
  write(text: string): void;
  /** Registers the handler for Ctrl+C while a turn runs; returns the unregister function. */
  onInterrupt(handler: () => void): () => void;
}

export interface ChatDeps {
  services: CliServices;
  ui: Prompter;
  approver: Approver;
  session: Session;
  io: ChatIo;
  verbose?: boolean;
  dryRun?: boolean;
  app?: string;
  /** Project folder for "deploy my project". */
  cwd: string;
  isTTY?: boolean;
}

export function toolLine(tool: string): string {
  return ch.tool[tool] ?? ch.toolGeneric(tool);
}

/** Agent events → short Persian lines (raw tool output only in verbose mode). */
export function renderAgentEvent(e: AgentEvent, verbose: boolean): string | undefined {
  switch (e.type) {
    case 'tool_start':
      return verbose ? `${toolLine(e.tool)}\n  ${redactText(JSON.stringify(e.args))}` : toolLine(e.tool);
    case 'tool_end':
      return e.ok ? undefined : ch.toolFailed(e.tool);
    case 'approval_needed':
      return ch.approvalNeeded(e.plan.titleFa);
    case 'human_step':
      return ch.humanStep(e.textFa);
    case 'message':
      return e.text;
    case 'error':
      return e.messageFa;
    default:
      return undefined;
  }
}

export async function runChat(deps: ChatDeps): Promise<void> {
  const { io, services: s, session } = deps;
  let dryRun = deps.dryRun === true;
  if (deps.app) session.setCurrentApp(deps.app);
  const history: string[] = [];

  io.write([ch.welcome, ch.suggestionsTitle, ...ch.suggestions.map((x) => `  • ${x}`), ch.hint].join('\n'));

  const toolCtx = (signal: AbortSignal): ToolContext => ({
    liara: s.liara,
    llm: s.llm,
    approver: deps.approver,
    audit: s.audit,
    policy: s.policy,
    session: session.approvals,
    sessionId: session.id,
    actor: 'user',
    signal,
    ...(dryRun ? { dryRun: true } : {}),
  });

  for (;;) {
    const line = await io.read(ch.prompt);
    if (line === undefined) break;
    const text = line.trim();
    if (!text) continue;

    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.split(/\s+/);
      if (cmd === '/exit' || cmd === '/quit') break;
      if (cmd === '/help') io.write(ch.help.join('\n'));
      else if (cmd === '/app') {
        if (rest[0]) {
          session.setCurrentApp(rest[0]);
          io.write(ch.appSet(rest[0]));
        } else io.write(session.currentApp ? ch.appSet(session.currentApp) : ch.noAppYet);
      } else if (cmd === '/dry-run') {
        dryRun = rest[0] !== 'off';
        io.write(ch.dryRun(dryRun));
      } else if (cmd === '/history') io.write(history.length ? history.slice(-10).map((h, i) => `${i + 1}. ${h}`).join('\n') : ch.historyEmpty);
      else io.write(ch.unknownCommand(cmd ?? text));
      continue;
    }

    history.push(text);
    const ac = new AbortController();
    const off = io.onInterrupt(() => ac.abort());
    try {
      const intent = await routeIntent(text, { llm: s.llm, signal: ac.signal });
      if (intent.app) session.setCurrentApp(intent.app);
      if (ac.signal.aborted) {
        // cancelled while classifying: nothing else starts
      } else if (intent.intent === 'deploy') {
        await runPipelineTool(deps, toolCtx(ac.signal), 'deploy_project', { path: deps.cwd });
      } else if (intent.intent === 'diagnose') {
        const app = session.currentApp;
        if (!app) io.write(ch.needApp);
        else await diagnose(deps, toolCtx(ac.signal), app, text);
      } else {
        await runAgentTurn(
          {
            llm: s.llm,
            registry: s.registry,
            liara: s.liara,
            approver: deps.approver,
            session,
            audit: s.audit,
            policy: s.policy,
            signal: ac.signal,
            ...(dryRun ? { dryRun: true } : {}),
            emit: (e) => {
              const out = renderAgentEvent(e, deps.verbose === true);
              if (out) io.write(out);
            },
          },
          text,
        );
      }
      if (ac.signal.aborted) io.write(ch.cancelled);
    } catch (e) {
      if (ac.signal.aborted) io.write(ch.cancelled);
      else throw e;
    } finally {
      off();
    }
  }
  session.save();
  io.write(ch.bye);
}

async function runPipelineTool(deps: ChatDeps, ctx: ToolContext, tool: string, args: Record<string, unknown>): Promise<void> {
  const s = deps.services;
  const view = new StepsView({ mode: renderMode({ isTTY: deps.isTTY === true }), write: (t) => deps.io.write(t) });
  s.pipelineEvents.sink = (e) => view.handle(e);
  deps.io.write(toolLine(tool));
  try {
    const r = await s.registry.invoke(tool, args, ctx);
    if (!r.ok) deps.io.write(r.error.messageFa);
  } finally {
    view.stop();
    delete s.pipelineEvents.sink;
  }
}

/** diagnose_app → (quick / root / skip) → fix_issue, like `siavash doctor`. */
async function diagnose(deps: ChatDeps, ctx: ToolContext, app: string, description: string): Promise<void> {
  const s = deps.services;
  deps.io.write(toolLine('diagnose_app'));
  const d = await s.registry.invoke('diagnose_app', { app, description }, ctx);
  if (!d.ok) {
    deps.io.write(d.error.messageFa);
    return;
  }
  const state = d.result as { healthy?: boolean; remediation?: { quickFix?: unknown; rootFix?: unknown } } | undefined;
  if (!state || state.healthy || (!state.remediation?.quickFix && !state.remediation?.rootFix)) return;
  const c = fa.cmd;
  const choice = await deps.ui.select(c.doctorChoose, [
    ...(state.remediation.rootFix ? [{ value: 'root' as const, label: c.doctorRoot }] : []),
    ...(state.remediation.quickFix ? [{ value: 'quick' as const, label: c.doctorQuick }] : []),
    { value: 'skip' as const, label: c.doctorSkip },
  ]);
  if (choice === CANCELLED || choice === 'skip') return;
  const f = await s.registry.invoke('fix_issue', { app, choice }, ctx);
  if (!f.ok) deps.io.write(f.error.messageFa);
  else {
    const v = (f.result as { verification?: { verdictFa?: string } } | undefined)?.verification;
    if (v?.verdictFa) deps.io.write(v.verdictFa);
  }
}

/**
 * Terminal I/O. A readline interface lives only while one question is asked, so it never competes with
 * the approval prompts (clack) for stdin. Ctrl+C at the prompt ends the chat; during a turn it cancels it.
 */
export function readlineIo(): ChatIo {
  return {
    read: async (prompt) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let ended = false;
      rl.on('SIGINT', () => {
        ended = true;
        rl.close();
      });
      rl.on('close', () => (ended = true));
      try {
        const answer = await Promise.race([rl.question(`${prompt} › `), new Promise<undefined>((r) => rl.once('close', () => r(undefined)))]);
        return ended && answer === undefined ? undefined : answer;
      } catch {
        return undefined;
      } finally {
        rl.close();
      }
    },
    write: (t) => process.stdout.write(`${t}\n`),
    onInterrupt: (h) => {
      process.on('SIGINT', h);
      return () => {
        process.off('SIGINT', h);
      };
    },
  };
}
