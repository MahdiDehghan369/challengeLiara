import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createFixRouter, FixDoneSignals } from '../coder/index.js';
import type { Config } from '../config/env.js';
import type { LiaraClient } from '../liara/index.js';
import type { LlmClient } from '../llm/types.js';
import { McpApprover, type Approver, type AuditSink } from '../safety/approval.js';
import type { Policy } from '../safety/policy.js';
import { redactText } from '../safety/redact.js';
import { Risk } from '../safety/risk.js';
import { ApprovalDeniedError } from '../shared/errors.js';
import type { ToolRegistry } from '../tools/registry.js';
import { CANCELLED, confirmationName, renderPlanCard, type Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { buildCliRegistry } from '../ui/cli/runtime.js';
import { IncidentBook } from './incidents.js';

/**
 * MCP server (T9.8) on stdio. Every registry tool is exposed; anything above R0 is two-step: the first
 * call returns `{status:"approval_required", plan, confirm_token}`, the second call with the token runs
 * it (R3 also needs `confirm_app_name`, typed by the user). Interactive pipelines stop with
 * `waiting_human` when they need a person. Collaboration tools let the user's own coding agent take a
 * Fix Brief and report the fix back.
 */

const m = fa.mcp;

/** No human on the MCP side: every question stops the call with `waiting_human`; notes are returned. */
export class McpPrompter implements Prompter {
  notes: string[] = [];
  question: string | undefined;

  reset(): void {
    this.notes = [];
    this.question = undefined;
  }

  note(body: string, title: string): void {
    this.notes.push(redactText(`${title}: ${body}`).slice(0, 1500));
  }

  async select(message: string): Promise<typeof CANCELLED> {
    this.question ??= message;
    return CANCELLED;
  }

  async text(message: string): Promise<typeof CANCELLED> {
    this.question ??= message;
    return CANCELLED;
  }
}

export interface McpServerDeps {
  config: Pick<Config, 'liara' | 'deployMode' | 'dataDir'>;
  liara: LiaraClient;
  llm: LlmClient;
  urlFor: (app: string) => string | Promise<string>;
  /** The user's project (Fix Briefs live in `<projectRoot>/.siavash/fix-briefs`). */
  projectRoot: string;
  audit?: AuditSink;
  policy?: Policy;
  version?: string;
  now?: () => number;
}

/**
 * Redacted JSON answer. `confirmToken` is added after redaction: it is the one-time approval nonce the
 * client must send back (not a credential), and the redactor would mask it because of its key name.
 */
const json = (value: Record<string, unknown>, isError = false, confirmToken?: string): CallToolResult => {
  const safe = JSON.parse(redactText(JSON.stringify(value))) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(confirmToken ? { ...safe, confirm_token: confirmToken } : safe, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
};

const COLLAB_TOOLS = [
  {
    name: 'get_fix_brief',
    description: 'Get the Fix Brief (a ready task in Markdown) for a code-caused incident, to fix the code in this project.',
    inputSchema: { type: 'object', properties: { incidentId: { type: 'string' } }, required: ['incidentId'] },
  },
  {
    name: 'report_fix_done',
    description: 'Tell Siavash the fix for an incident is committed, so it can be validated, deployed (redeploy_app, two-step) and verified (diagnose_app).',
    inputSchema: { type: 'object', properties: { incidentId: { type: 'string' }, commit: { type: 'string' } }, required: ['incidentId'] },
  },
  {
    name: 'get_incident_status',
    description: 'Status of an incident: waiting-fix, fix-reported or resolved.',
    inputSchema: { type: 'object', properties: { incidentId: { type: 'string' } }, required: ['incidentId'] },
  },
  {
    name: 'list_open_incidents',
    description: 'Incidents that still need a fix or a deploy.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

const CONFIRM_PROPS = {
  confirm_token: { type: 'string', description: 'Second step: the confirm_token from the approval_required answer, after the user approved.' },
  confirm_app_name: { type: 'string', description: 'R3 only: the app name exactly as the user typed it.' },
};

const PROMPTS = [
  { name: 'deploy-my-project', description: 'Deploy the current project to Liara with Siavash.', arguments: [{ name: 'path', description: 'Project folder', required: false }] },
  { name: 'diagnose-my-site', description: 'Find out why an app is slow or failing.', arguments: [{ name: 'app', description: 'Liara app name', required: true }] },
  { name: 'fix-incident', description: 'Load the Fix Brief of an incident and fix it in this project.', arguments: [{ name: 'incidentId', description: 'Incident id', required: true }] },
];

export function createMcpServer(deps: McpServerDeps, opts: { registry?: ToolRegistry } = {}) {
  const prompter = new McpPrompter();
  const book = new IncidentBook(deps.projectRoot);
  const signals = new FixDoneSignals();
  const tokens = new McpApprover(deps.now);
  const codeFix = createFixRouter({
    root: deps.projectRoot,
    ui: prompter,
    forceMode: 'handoff',
    wait: false,
    signals,
    copy: async () => false,
    self: async () => ({ status: 'skipped' }),
    redeploy: async () => ({ status: 'skipped' }),
    onBrief: (req, briefPath) => book.upsert({ id: req.incidentId, app: req.app, titleFa: req.hypothesis.titleFa, status: 'waiting-fix', briefPath }),
  });
  const registry = opts.registry ?? buildCliRegistry({ config: deps.config, liara: deps.liara, ui: prompter, urlFor: deps.urlFor, codeFix });

  const server = new Server({ name: 'siavash', version: deps.version ?? '0.1.0' }, { capabilities: { tools: {}, resources: {}, prompts: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...registry.toMcpTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: { ...t.inputSchema, type: 'object' as const, properties: { ...((t.inputSchema.properties as Record<string, unknown> | undefined) ?? {}), ...CONFIRM_PROPS } },
      })),
      ...COLLAB_TOOLS.map((t) => ({ ...t, inputSchema: { ...t.inputSchema } })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const name = req.params.name;
    const raw = { ...(req.params.arguments ?? {}) } as Record<string, unknown>;
    const collab = await callCollab(name, raw);
    if (collab) return collab;

    const confirmToken = typeof raw.confirm_token === 'string' ? raw.confirm_token : undefined;
    const confirmName = typeof raw.confirm_app_name === 'string' ? raw.confirm_app_name : undefined;
    delete raw.confirm_token;
    delete raw.confirm_app_name;

    // R3 needs the name the user typed, checked before the token is consumed
    const approver: Approver = {
      request: async (plan, ctx) => {
        if (plan.risk >= Risk.R3 && ctx?.confirmToken && confirmName?.trim() !== confirmationName(plan)) {
          throw new ApprovalDeniedError('R3 confirm_app_name mismatch', { messageFa: m.appNameMismatch });
        }
        return tokens.request(plan, ctx);
      },
    };
    prompter.reset();
    const r = await registry.invoke(name, raw, {
      liara: deps.liara,
      llm: deps.llm,
      approver,
      actor: 'agent',
      sessionId: 'mcp',
      ...(deps.audit ? { audit: deps.audit } : {}),
      ...(deps.policy ? { policy: deps.policy } : {}),
      ...(confirmToken ? { confirmToken } : {}),
    });
    if (!r.ok) return json({ status: 'error', code: r.error.code, messageFa: r.error.messageFa }, true);
    if (r.status === 'pending') {
      return json(
        {
          status: 'approval_required',
          risk: `R${r.plan.risk}`,
          plan: renderPlanCard(r.plan, { color: false }),
          messageFa: [m.approvalRequired, ...(r.plan.risk >= Risk.R3 ? [m.appNameRequired(confirmationName(r.plan))] : [])].join('\n'),
          ...(r.plan.risk >= Risk.R3 ? { requires_confirm_app_name: true } : {}),
        },
        false,
        r.confirmToken,
      );
    }
    if (r.status === 'dry-run') return json({ status: 'dry_run', plan: renderPlanCard(r.plan, { color: false }) });
    const pipelineWaiting = (r.result as { status?: string } | undefined)?.status === 'waiting-human';
    const result = parseMaybe(r.forLlm);
    if (prompter.question || pipelineWaiting) {
      return json({ status: 'waiting_human', messageFa: m.waitingHuman, ...(prompter.question ? { question: prompter.question } : {}), notes: prompter.notes, result });
    }
    const handedOff = book.listOpen().some((e) => e.status === 'waiting-fix' && JSON.stringify(result).includes(e.id));
    return json({ status: 'ok', result, ...(prompter.notes.length ? { notes: prompter.notes } : {}), ...(handedOff ? { messageFa: m.handedOff } : {}) });
  });

  async function callCollab(name: string, args: Record<string, unknown>): Promise<CallToolResult | undefined> {
    const id = typeof args.incidentId === 'string' ? args.incidentId : '';
    switch (name) {
      case 'get_fix_brief': {
        if (!book.get(id)) return json({ status: 'error', messageFa: m.unknownIncident(id) }, true);
        const brief = book.brief(id);
        return brief ? { content: [{ type: 'text', text: brief }] } : json({ status: 'error', messageFa: m.noBrief(id) }, true);
      }
      case 'report_fix_done': {
        const e = book.get(id);
        if (!e) return json({ status: 'error', messageFa: m.unknownIncident(id) }, true);
        const commit = z.string().max(80).safeParse(args.commit);
        book.upsert({ ...e, status: 'fix-reported', ...(commit.success ? { commit: commit.data } : {}) });
        const notified = signals.notify(id, commit.success ? commit.data : undefined);
        return json({ status: 'ok', incidentId: id, notified, messageFa: m.fixReported });
      }
      case 'get_incident_status': {
        const e = book.get(id);
        return e ? json({ ...e }) : json({ status: 'error', messageFa: m.unknownIncident(id) }, true);
      }
      case 'list_open_incidents':
        return json({ incidents: book.listOpen() });
      default:
        return undefined;
    }
  }

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'liara://apps', name: 'Liara apps', mimeType: 'application/json' },
      ...book.listOpen().map((e) => ({ uri: `siavash://incidents/${e.id}`, name: `Incident ${e.id}`, mimeType: 'application/json' })),
    ],
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [{ uriTemplate: 'siavash://incidents/{id}', name: 'Incident', mimeType: 'application/json' }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;
    if (uri === 'liara://apps') {
      const r = await registry.invoke('list_apps', {}, { liara: deps.liara, approver: tokens, actor: 'agent' });
      return { contents: [{ uri, mimeType: 'application/json', text: r.forLlm }] };
    }
    const inc = /^siavash:\/\/incidents\/([\w.-]+)$/.exec(uri);
    const entry = inc ? book.get(inc[1] as string) : undefined;
    if (!entry) throw new Error(`unknown resource: ${uri}`);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ...entry, brief: book.brief(entry.id) ?? null }) }] };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const a = req.params.arguments ?? {};
    const text = (s: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: s } }] });
    switch (req.params.name) {
      case 'deploy-my-project':
        return text(`Deploy the project in ${a.path ?? 'the current folder'} to Liara with the siavash tools: call deploy_project, show every approval card to me and only confirm what I approve.`);
      case 'diagnose-my-site':
        return text(`My Liara app "${a.app ?? ''}" has a problem. Call diagnose_app for it, explain the most likely cause with its evidence, and ask me before fix_issue.`);
      case 'fix-incident': {
        const brief = a.incidentId ? book.brief(a.incidentId) : undefined;
        if (!brief) throw new Error(`no Fix Brief for incident ${a.incidentId ?? ''}`);
        return text(`${brief}\n\nFollow this brief in this project. When the fix is committed, call report_fix_done({ incidentId: "${a.incidentId}" }).`);
      }
      default:
        throw new Error(`unknown prompt: ${req.params.name}`);
    }
  });

  return { server, book, signals, prompter, registry };
}

function parseMaybe(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** `siavash mcp`: serve on stdio until the client disconnects. */
export async function startStdioServer(deps: McpServerDeps): Promise<void> {
  const { server } = createMcpServer(deps);
  await server.connect(new StdioServerTransport());
}
