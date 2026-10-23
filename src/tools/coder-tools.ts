import { resolve } from 'node:path';
import { z } from 'zod';
import { runCodePatch, type CodePatchDeps, type CodePatchResult, type RedeployOutcome } from '../coder/code-patch.js';
import { newPlanId } from '../ops/context.js';
import { Risk } from '../safety/risk.js';
import { ValidationError } from '../shared/errors.js';
import type { Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolContext, type ToolDefinition } from './types.js';

/**
 * Coder tools (T8.9). `code_patch` starts with an R1 card (local work only on a fix branch); the actual
 * change — commit and redeploy — sits behind the R2 card that shows the diff, cause and test result.
 */

export interface CoderToolsOptions {
  ui?: Prompter;
  validation?: CodePatchDeps['validation'];
  /** Redeploy used in deploy mode (wire `runRedeploy` with `preApproved: true`). */
  redeploy?: (ctx: ToolContext, app: string, root: string) => Promise<RedeployOutcome>;
}

export function coderTools(opts: CoderToolsOptions = {}): ToolDefinition[] {
  const p = fa.patch;
  const tools = [
    defineTool({
      name: 'code_patch',
      descriptionFa: p.toolDescription,
      descriptionEn:
        'Fix a code bug: build a minimal patch from the stack trace, apply it on a fix branch, run the local build/tests, then ask for approval with the diff before commit and redeploy. mode: deploy (default) | apply-only | show-only.',
      inputSchema: z.object({
        app: z.string().min(1),
        path: z.string().min(1).describe('Local project directory'),
        incidentId: z.string().min(1).max(40),
        error: z.string().min(1).describe('Error message with stack trace'),
        route: z.string().optional(),
        mode: z.enum(['deploy', 'apply-only', 'show-only']).default('deploy'),
      }),
      risk: Risk.R1,
      buildPlan: async (a) => ({
        id: newPlanId('code_patch_start'),
        toolName: 'code_patch',
        titleFa: p.startTitle(a.app),
        reasonFa: fa.tools.defaultReason,
        target: { app: a.app },
        risk: Risk.R1,
        impactFa: p.startImpact,
        rollbackFa: p.startRollback,
        command: `code_patch --mode ${a.mode} --path ${a.path}`,
        params: { app: a.app, path: a.path, incidentId: a.incidentId, mode: a.mode },
      }),
      handler: async (a, ctx): Promise<CodePatchResult> => {
        if (!ctx.llm) throw new ValidationError('code_patch needs an LLM');
        const root = resolve(a.path);
        return runCodePatch(
          {
            llm: ctx.llm,
            ops: ctx,
            ...(opts.ui ? { ui: opts.ui } : {}),
            ...(opts.validation ? { validation: opts.validation } : {}),
            ...(opts.redeploy ? { redeploy: (app: string, dir: string) => opts.redeploy!(ctx, app, dir) } : {}),
          },
          { root, app: a.app, incidentId: a.incidentId, error: a.error, mode: a.mode, ...(a.route ? { route: a.route } : {}) },
        );
      },
      summarizeForLlm: (r: CodePatchResult) => ({
        status: r.status,
        rounds: r.rounds,
        summaryFa: r.summaryFa,
        messageFa: r.messageFa,
        tests: r.validation ? { ok: r.validation.ok, skipped: r.validation.skipped } : undefined,
        commit: r.commit,
        deploy: r.deploy,
      }),
    }),
  ];
  return tools as ToolDefinition[];
}
