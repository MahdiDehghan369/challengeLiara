import { resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from '../config/env.js';
import { runDeployPipeline, type DeployPipelineDeps } from '../deploy/pipeline.js';
import type { PipelineEvent, PipelineResult } from '../deploy/pipeline-engine.js';
import { runRedeploy, type RedeployDeps } from '../deploy/redeploy.js';
import type { SummaryState } from '../deploy/steps/summary.js';
import { newPlanId } from '../ops/context.js';
import { Risk } from '../safety/risk.js';
import type { Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolContext, type ToolDefinition } from './types.js';

/**
 * Deploy tools (T5.10). `deploy_project` starts the interactive pipeline after an R1 card; every
 * resource and its cost is still approved inside (R2 deploy-plan card, R2 database, …). `redeploy_app`
 * is R1; its approval covers the inner `deploy_app` of the same app, so it is not asked twice.
 */

export interface DeployToolsOptions {
  config: Pick<Config, 'liara' | 'deployMode'>;
  ui: Prompter;
  useLlm?: boolean;
  yes?: boolean;
  /** Extra pipeline deps (tests / mock: urlFor, probe, wait, observeMs…). */
  pipeline?: Partial<Omit<DeployPipelineDeps, 'config' | 'liara' | 'ui' | 'ops'>>;
  redeploy?: Partial<Omit<RedeployDeps, 'config' | 'liara' | 'ui' | 'ops' | 'app' | 'preApproved'>>;
  /** Step transitions for a live checklist (T9.3). */
  onPipelineEvent?: (e: PipelineEvent) => void;
}

/** What the LLM sees: outcome, failing step and the summary card data — no raw logs. */
export function summarizePipeline(r: PipelineResult<SummaryState>): Record<string, unknown> {
  return {
    status: r.status,
    ...(r.failedStep ? { failedStep: r.failedStep } : {}),
    ...(r.messageFa ? { messageFa: r.messageFa } : {}),
    app: r.state.appName,
    deployment: r.state.deployment,
    health: r.state.verify ? { verdict: r.state.verify.verdict, score: r.state.verify.score, reasonsFa: r.state.verify.reasonsFa } : undefined,
    summary: r.state.summary,
  };
}

const Path = z.string().min(1).describe('Project directory to deploy');

export function deployTools(opts: DeployToolsOptions): ToolDefinition[] {
  const t = fa.deployTools;
  const opsOf = (ctx: ToolContext) => ({
    approver: ctx.approver,
    ...(ctx.audit ? { audit: ctx.audit } : {}),
    ...(ctx.session ? { session: ctx.session } : {}),
    ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
    ...(ctx.actor ? { actor: ctx.actor } : {}),
    ...(ctx.risk ? { risk: ctx.risk } : {}),
  });
  const tools = [
    defineTool({
      name: 'deploy_project',
      descriptionFa: t.deployProject,
      descriptionEn:
        'Deploy a local project to Liara end to end (preflight, analysis, plan and cost, create app/db/disk, env, deploy, health check). Interactive: each cost and resource is approved separately.',
      inputSchema: z.object({ path: Path }),
      risk: Risk.R1,
      buildPlan: async (a) => ({
        id: newPlanId('deploy_project'),
        toolName: 'deploy_project',
        titleFa: t.startTitle(a.path),
        reasonFa: fa.tools.defaultReason,
        target: {},
        risk: Risk.R1,
        impactFa: t.startImpact,
        rollbackFa: t.startRollback,
        command: `siavash deploy ${a.path}`,
        params: { path: a.path },
      }),
      handler: async (a, ctx) =>
        runDeployPipeline(resolve(a.path), {
          config: opts.config,
          liara: ctx.liara,
          ui: opts.ui,
          ops: opsOf(ctx),
          ...(ctx.llm ? { llm: ctx.llm } : {}),
          ...(opts.useLlm !== undefined ? { useLlm: opts.useLlm } : {}),
          ...(ctx.policy ? { policy: ctx.policy } : {}),
          ...(opts.yes ? { yes: true } : {}),
          ...opts.pipeline,
        }, opts.onPipelineEvent ? { onEvent: opts.onPipelineEvent } : {}),
      summarizeForLlm: summarizePipeline,
    }),
    defineTool({
      name: 'redeploy_app',
      descriptionFa: t.redeployApp,
      descriptionEn: 'Deploy the current code of a project again to its existing Liara app (preflight, deploy, health check).',
      inputSchema: z.object({ path: Path, app: z.string().min(1).optional().describe('Liara app name (default: from .siavash/project.json)') }),
      risk: Risk.R1,
      buildPlan: async (a) => ({
        id: newPlanId('redeploy_app'),
        toolName: 'redeploy_app',
        titleFa: fa.deployStep.approveTitle(a.app ?? a.path),
        reasonFa: fa.deployStep.approveReason,
        target: a.app ? { app: a.app } : {},
        risk: Risk.R1,
        impactFa: fa.deployStep.approveImpact(opts.config.deployMode),
        rollbackFa: fa.deployStep.approveRollback,
        command: `siavash redeploy ${a.app ?? ''} --path ${a.path}`.replace(/\s+/g, ' '),
        params: { path: a.path, ...(a.app ? { app: a.app } : {}) },
      }),
      handler: async (a, ctx) =>
        runRedeploy(resolve(a.path), {
          config: opts.config,
          liara: ctx.liara,
          ui: opts.ui,
          ops: opsOf(ctx),
          ...(a.app ? { app: a.app } : {}),
          preApproved: true,
          ...opts.redeploy,
        }, opts.onPipelineEvent ? { onEvent: opts.onPipelineEvent } : {}),
      summarizeForLlm: summarizePipeline,
    }),
  ];
  return tools as ToolDefinition[];
}
