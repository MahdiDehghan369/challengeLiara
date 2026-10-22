import { z } from 'zod';
import type { ToolDef } from '../llm/index.js';
import { guardOptions, newPlanId } from '../ops/context.js';
import { guard, type GuardOptions } from '../safety/approval.js';
import { redactObject, redactText } from '../safety/redact.js';
import { Risk, type ActionPlan } from '../safety/risk.js';
import { BudgetExceededError, isSiavashError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

export const LLM_OUTPUT_MAX = 4000;

/** Serialises a result for the LLM: redacted (Secrets → placeholder via toJSON), capped at 4000 chars. */
export function forLlm(value: unknown, max = LLM_OUTPUT_MAX): string {
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(redactObject(value)) ?? 'null';
    } catch {
      text = String(value);
    }
  }
  text = redactText(text);
  if (text.length <= max) return text;
  const marker = `…[truncated ${text.length - max + 40} chars]`;
  return text.slice(0, max - marker.length) + marker;
}

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  // input shape: fields with defaults stay optional for the LLM
  const s = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
  delete s.$schema;
  return s;
}

/**
 * Tool Registry (T3.3). The only way the agent changes anything:
 * zod → buildPlan → Safety Gate (`guard`) → handler → audit → redacted, capped output for the LLM.
 * Invalid input, unknown tools and denials return `{ok:false}` that the LLM can read — never exceptions
 * (except `BudgetExceededError`, which must stop the agent loop).
 */
export class ToolRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools = new Map<string, ToolDefinition<any, any>>();

  register<I, R>(tool: ToolDefinition<I, R>): this {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(tool.name)) throw new Error(`invalid tool name: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Tool list for the LLM (`ToolDef` = OpenAI function shape; the JSON protocol uses the same). */
  toOpenAiTools(filter?: (t: ToolDefinition) => boolean): ToolDef[] {
    return this.list()
      .filter(filter ?? (() => true))
      .map((t) => ({ name: t.name, description: t.descriptionEn, parameters: jsonSchemaOf(t.inputSchema) }));
  }

  toMcpTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return this.list().map((t) => ({ name: t.name, description: t.descriptionEn, inputSchema: jsonSchemaOf(t.inputSchema) }));
  }

  private fail(code: string, message: string, messageFa: string, details?: unknown): ToolResult<never> {
    return {
      ok: false,
      error: { code, message, messageFa },
      forLlm: forLlm({ error: code, message, ...(details === undefined ? {} : { details }) }),
    };
  }

  private defaultPlan(tool: ToolDefinition, args: unknown, risk: Risk): ActionPlan {
    const app = (args as { app?: unknown } | undefined)?.app;
    return {
      id: newPlanId(tool.name),
      toolName: tool.name,
      titleFa: fa.tools.readTitle(tool.name),
      reasonFa: fa.tools.defaultReason,
      target: typeof app === 'string' ? { app } : {},
      risk,
      impactFa: fa.tools.readImpact,
      rollbackFa: fa.tools.noRollback,
      command: `${tool.name} ${JSON.stringify(args)}`,
      params: (args ?? {}) as Record<string, unknown>,
    };
  }

  async invoke(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return this.fail('UNKNOWN_TOOL', `Unknown tool: ${name}. Available: ${[...this.tools.keys()].join(', ')}`, fa.tools.unknownTool(name));

    const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
      return this.fail('INVALID_INPUT', `Invalid arguments for ${name}: ${issues.join('; ')}`, fa.tools.invalidInput(name), {
        expected: jsonSchemaOf(tool.inputSchema),
      });
    }
    const args = parsed.data;
    const started = Date.now();
    ctx.ui?.emit({ type: 'tool_start', tool: name, args: redactObject(args) });
    try {
      const risk = typeof tool.risk === 'function' ? tool.risk(args, ctx) : tool.risk;
      if (risk > Risk.R0 && !tool.buildPlan) throw new Error(`tool ${name} (R${risk}) has no buildPlan`);
      const plan = tool.buildPlan ? await tool.buildPlan(args, ctx) : this.defaultPlan(tool, args, risk);
      const planWithRisk = plan.risk >= risk ? plan : { ...plan, risk };
      const opts: GuardOptions = {
        ...guardOptions(ctx),
        ...(ctx.policy ? { policy: ctx.policy } : {}),
        ...(ctx.headless ? { headless: true } : {}),
      };
      const r = await guard(
        planWithRisk,
        ctx.approver,
        async (params) => {
          // Unedited → the plan's own params object comes back: run with the validated args (plan params
          // may hold fingerprints, not values). Edited on the approval card → validate again first.
          if (params === planWithRisk.params) return tool.handler(args, ctx);
          return tool.handler(tool.inputSchema.parse({ ...(args as object), ...params }), ctx);
        },
        opts,
      );
      if (r.status === 'dry-run') {
        ctx.ui?.emit({ type: 'tool_end', tool: name, ok: true, status: 'dry-run', ms: Date.now() - started });
        return { ok: true, status: 'dry-run', plan: r.plan, forLlm: forLlm({ dryRun: true, plan: { title: r.plan.titleFa, risk: `R${r.plan.risk}`, command: r.plan.command } }) };
      }
      if (r.status === 'pending') {
        ctx.ui?.emit({ type: 'tool_end', tool: name, ok: true, status: 'pending', ms: Date.now() - started });
        return {
          ok: true,
          status: 'pending',
          plan: r.plan,
          confirmToken: r.token,
          forLlm: forLlm({ pendingApproval: true, risk: `R${r.plan.risk}`, title: r.plan.titleFa, expiresAt: new Date(r.expiresAt).toISOString() }),
        };
      }
      const summary = tool.summarizeForLlm ? tool.summarizeForLlm(r.result, args) : r.result;
      ctx.ui?.emit({ type: 'tool_end', tool: name, ok: true, status: 'executed', ms: Date.now() - started });
      return { ok: true, status: 'executed', plan: r.plan, result: r.result, forLlm: forLlm(summary ?? { ok: true }) };
    } catch (e) {
      ctx.ui?.emit({ type: 'tool_end', tool: name, ok: false, status: 'error', ms: Date.now() - started });
      if (e instanceof BudgetExceededError) throw e;
      if (isSiavashError(e)) return this.fail(e.code, redactText(e.message), e.messageFa, e.details);
      if (e instanceof z.ZodError) return this.fail('INVALID_INPUT', `Edited arguments invalid: ${e.message}`, fa.tools.invalidInput(name));
      const msg = e instanceof Error ? e.message : String(e);
      return this.fail('TOOL_ERROR', redactText(msg), fa.errors.externalCommand);
    }
  }
}
