import type { z } from 'zod';
import type { LiaraClient } from '../liara/index.js';
import type { LlmClient } from '../llm/index.js';
import type { OpsContext } from '../ops/context.js';
import type { Policy } from '../safety/policy.js';
import type { ActionPlan, Risk } from '../safety/risk.js';

/** UI events emitted while tools run (consumed by the agent loop / CLI, T3.6). */
export type ToolUiEvent =
  | { type: 'tool_start'; tool: string; args: unknown }
  | { type: 'tool_end'; tool: string; ok: boolean; status: string; ms: number };

export interface ToolUi {
  emit(event: ToolUiEvent): void;
}

/** Everything a tool can use. Extends the ops context, so tools can reuse ops plan builders. */
export interface ToolContext extends OpsContext {
  liara: LiaraClient;
  llm?: LlmClient;
  ui?: ToolUi;
  signal?: AbortSignal;
  policy?: Policy;
  headless?: boolean;
}

export interface ToolDefinition<I = unknown, R = unknown> {
  name: string;
  descriptionFa: string;
  /** Sent to the LLM. */
  descriptionEn: string;
  inputSchema: z.ZodType<I>;
  risk: Risk | ((args: I, ctx: ToolContext) => Risk);
  /** Required for state-changing tools; R0 tools get a default read-only plan. */
  buildPlan?: (args: I, ctx: ToolContext) => Promise<ActionPlan>;
  handler: (args: I, ctx: ToolContext) => Promise<R>;
  /** What the LLM sees instead of the raw result (keep it small; it is redacted and capped anyway). */
  summarizeForLlm?: (result: R, args: I) => unknown;
}

/** Identity helper that keeps the generic types of a tool definition. */
export function defineTool<I, R>(def: ToolDefinition<I, R>): ToolDefinition<I, R> {
  return def;
}

export type ToolStatus = 'executed' | 'dry-run' | 'pending';

export type ToolResult<R = unknown> =
  | {
      ok: true;
      status: ToolStatus;
      /** Redacted, ≤ 4000-char text for the LLM. */
      forLlm: string;
      result?: R;
      plan: ActionPlan;
      /** MCP two-step approval. */
      confirmToken?: string;
    }
  | {
      ok: false;
      error: { code: string; message: string; messageFa: string };
      /** Redacted explanation for the LLM. */
      forLlm: string;
    };
