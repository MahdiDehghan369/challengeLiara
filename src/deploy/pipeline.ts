import type { Session } from '../agent/session.js';
import type { Config } from '../config/env.js';
import type { LiaraClient } from '../liara/index.js';
import type { LlmClient } from '../llm/types.js';
import type { OpsContext } from '../ops/context.js';
import { PlanCatalog } from '../planner/plans.js';
import type { Policy } from '../safety/policy.js';
import type { ProbeOptions } from '../sre/health.js';
import type { Prompter } from '../ui/cli/approver.js';
import { runPipeline, type Pipeline, type PipelineEvent, type PipelineResult } from './pipeline-engine.js';
import { analyzeStep } from './steps/analyze.js';
import { configureStep } from './steps/configure.js';
import { deployStep } from './steps/deploy.js';
import { planBillingStep } from './steps/plan-billing.js';
import { preflightStep } from './steps/preflight.js';
import { provisionStep, SecretStore } from './steps/provision.js';
import { summaryStep, type SummaryState } from './steps/summary.js';
import { verifyStep, type VerifyResult } from './steps/verify.js';

/**
 * The full deploy pipeline (T5.10): preflight → analyze → plan & billing → provision → configure →
 * deploy → verify → summary. Every Liara change inside goes through the Safety Gate.
 * TODO(T5.9): domain & SSL step after verify once implemented.
 */

export const DEPLOY_PIPELINE_ID = 'deploy';

export interface DeployPipelineDeps {
  config: Pick<Config, 'liara' | 'deployMode'>;
  liara: LiaraClient;
  ui: Prompter;
  ops: OpsContext;
  llm?: LlmClient;
  useLlm?: boolean;
  policy?: Policy;
  yes?: boolean;
  verbose?: boolean;
  onLine?: (line: string) => void;
  catalog?: PlanCatalog;
  secrets?: SecretStore;
  /** Tuning/injection (tests, mock): */
  dbPlan?: string;
  urlFor?: (app: string) => string | Promise<string>;
  probe?: Pick<ProbeOptions, 'count' | 'timeoutMs' | 'fetchImpl'>;
  wait?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> };
  observeMs?: number;
  pollMs?: number;
  onUnhealthy?: (result: VerifyResult) => Promise<void> | void;
}

export function buildDeployPipeline(projectPath: string, deps: DeployPipelineDeps): Pipeline<SummaryState> {
  const secrets = deps.secrets ?? new SecretStore();
  const catalog = deps.catalog ?? new PlanCatalog(deps.liara.cli);
  const mode = deps.config.deployMode;
  return {
    id: DEPLOY_PIPELINE_ID,
    steps: [
      preflightStep({ liara: deps.liara, config: deps.config, projectPath }),
      analyzeStep({ projectPath, liara: deps.liara, ui: deps.ui, ...(deps.llm ? { llm: deps.llm } : {}), ...(deps.useLlm !== undefined ? { useLlm: deps.useLlm } : {}), ...(deps.yes ? { yes: true } : {}) }),
      planBillingStep({
        liara: deps.liara,
        catalog,
        ui: deps.ui,
        ops: deps.ops,
        ...(deps.policy ? { policy: deps.policy } : {}),
        ...(deps.yes ? { yes: true } : {}),
        ...(deps.pollMs !== undefined ? { pollMs: deps.pollMs } : {}),
        ...(deps.wait?.sleep ? { sleep: deps.wait.sleep } : {}),
      }),
      provisionStep({
        liara: deps.liara,
        ui: deps.ui,
        ops: deps.ops,
        secrets,
        ...(deps.yes ? { yes: true } : {}),
        ...(deps.dbPlan ? { dbPlan: deps.dbPlan } : {}),
        ...(deps.wait ? { wait: deps.wait } : {}),
      }),
      configureStep({ liara: deps.liara, ui: deps.ui, ops: deps.ops, secrets, ...(deps.yes ? { yes: true } : {}) }),
      deployStep({
        liara: deps.liara,
        ui: deps.ui,
        ops: deps.ops,
        mode,
        ...(deps.verbose ? { verbose: true } : {}),
        ...(deps.onLine ? { onLine: deps.onLine } : {}),
        ...(deps.wait ? { wait: deps.wait } : {}),
      }),
      verifyStep({
        liara: deps.liara,
        ui: deps.ui,
        ...(deps.urlFor ? { urlFor: deps.urlFor } : {}),
        ...(deps.probe ? { probe: deps.probe } : {}),
        ...(deps.wait ? { wait: deps.wait } : {}),
        ...(deps.observeMs !== undefined ? { observeMs: deps.observeMs } : {}),
        ...(deps.onUnhealthy ? { onUnhealthy: deps.onUnhealthy } : {}),
      }),
      summaryStep({ liara: deps.liara, ui: deps.ui, deployMode: mode }),
    ],
  };
}

export interface RunOptions {
  session?: Session;
  resume?: boolean;
  signal?: AbortSignal;
  onEvent?: (e: PipelineEvent) => void;
}

export function runDeployPipeline(projectPath: string, deps: DeployPipelineDeps, run: RunOptions = {}): Promise<PipelineResult<SummaryState>> {
  return runPipeline(buildDeployPipeline(projectPath, deps), {
    state: {},
    ...(run.session ? { session: run.session } : {}),
    ...(run.resume ? { resume: true } : {}),
    ...(run.signal ? { signal: run.signal } : {}),
    ...(run.onEvent ? { onEvent: run.onEvent } : {}),
  });
}
