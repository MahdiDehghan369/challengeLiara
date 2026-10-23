import type { LlmClient } from '../llm/types.js';
import { guardOptions, newPlanId, type OpsContext } from '../ops/context.js';
import { guard } from '../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../safety/risk.js';
import { ApprovalDeniedError } from '../shared/errors.js';
import { parseFrames, type StackFrame } from '../sre/log-cluster.js';
import type { Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { applyPatch, commitPatch, previewPatch, revertPatch, type AppliedPatch } from './apply.js';
import { collectCodeContext } from './context.js';
import { generatePatch, type GeneratedPatch } from './patch.js';
import { runValidation, type RunValidationOptions, type ValidationResult } from './validate.js';

/**
 * `code_patch` flow (T8.9): context → patch → apply on a fix branch → local validation (≤ 2 correction
 * rounds, then full revert) → R2 card with diff, root cause and test result → commit → redeploy (+ verify).
 * Denied or failed → everything is reverted. Modes: deploy / apply-only / show-only.
 */

export type CodePatchMode = 'deploy' | 'apply-only' | 'show-only';
export const MAX_FIX_ROUNDS = 2;
const CARD_DIFF_MAX = 3000;

export interface CodePatchInput {
  root: string;
  app: string;
  incidentId: string;
  /** Error header + stack trace (redacted again before it reaches the LLM). */
  error: string;
  frames?: StackFrame[];
  route?: string;
  mode: CodePatchMode;
}

export interface RedeployOutcome {
  status: string;
  verdict?: string;
  messageFa?: string;
}

export interface CodePatchDeps {
  llm: LlmClient;
  ops: OpsContext;
  ui?: Prompter;
  validation?: Omit<RunValidationOptions, 'changedFiles'>;
  /** Deploy mode: redeploys the app from `root` (its own deploy card is covered by the code_patch card). */
  redeploy?: (app: string, root: string) => Promise<RedeployOutcome>;
}

export interface CodePatchResult {
  status: 'deployed' | 'applied' | 'shown' | 'rejected' | 'failed';
  rounds: number;
  summaryFa?: string;
  rootCauseFa?: string;
  diff?: string;
  validation?: ValidationResult;
  branch?: string;
  commit?: string;
  deploy?: RedeployOutcome;
  messageFa?: string;
}

function testsText(v: ValidationResult): string {
  const p = fa.patch;
  if (v.skipped) return p.testsSkipped;
  return v.ok ? p.testsPassed : p.testsFailed(v.steps.filter((s) => !s.ok).map((s) => s.command).join(', '));
}

export function codePatchPlan(input: CodePatchInput, patch: GeneratedPatch, applied: AppliedPatch, validation: ValidationResult, ctx: Pick<OpsContext, 'risk'>): ActionPlan {
  const p = fa.patch;
  const diff = applied.diff.length > CARD_DIFF_MAX ? `${applied.diff.slice(0, CARD_DIFF_MAX)}\n…` : applied.diff;
  return escalate(
    {
      id: newPlanId('code_patch'),
      toolName: 'code_patch',
      titleFa: p.cardTitle(input.app),
      reasonFa: patch.summaryFa,
      target: { app: input.app },
      risk: Risk.R2,
      impactFa: p.cardImpact(patch.rootCauseFa, testsText(validation), diff),
      rollbackFa: applied.mode === 'git' ? p.cardRollbackGit(applied.branch as string) : p.cardRollbackBackup,
      command: [`git commit -m "fix: … (siavash incident ${input.incidentId})"`, ...(input.mode === 'deploy' ? [`redeploy ${input.app}`] : [])].join('\n'),
      params: { app: input.app, incidentId: input.incidentId, files: [...applied.edited, ...applied.created], mode: input.mode },
    },
    ctx.risk ?? {},
  );
}

export async function runCodePatch(deps: CodePatchDeps, input: CodePatchInput): Promise<CodePatchResult> {
  const p = fa.patch;
  const frames = input.frames ?? parseFrames(input.error);
  const context = collectCodeContext(input.root, {
    frames,
    message: input.error.split('\n')[0] ?? input.error,
    ...(input.route ? { route: input.route } : {}),
  });
  let patch = await generatePatch(deps.llm, { root: input.root, app: input.app, error: input.error, context });
  if (input.mode === 'show-only') {
    return { status: 'shown', rounds: 1, summaryFa: patch.summaryFa, rootCauseFa: patch.rootCauseFa, diff: previewPatch(input.root, patch).diff };
  }

  let applied: AppliedPatch | undefined;
  let validation: ValidationResult | undefined;
  let rounds = 0;
  for (let round = 0; ; round++) {
    rounds = round + 1;
    applied = await applyPatch(input.root, patch, input.incidentId);
    validation = await runValidation(input.root, { ...deps.validation, changedFiles: [...applied.edited, ...applied.created] });
    if (validation.ok) break;
    await revertPatch(applied);
    if (round >= MAX_FIX_ROUNDS) {
      return { status: 'failed', rounds: round + 1, summaryFa: patch.summaryFa, validation, messageFa: p.validationFailed(round + 1) };
    }
    const failures = validation.steps.filter((s) => !s.ok).map((s) => `$ ${s.command} (exit ${String(s.exitCode)})\n${s.outputTail}`).join('\n\n');
    patch = await generatePatch(deps.llm, {
      root: input.root,
      app: input.app,
      error: `${input.error}\n\nA previous fix was applied but local validation failed:\n${failures}`,
      context,
    });
  }

  deps.ui?.note(applied.diff, p.cardTitle(input.app));
  const plan = codePatchPlan(input, patch, applied, validation, deps.ops);
  const base = { rounds, summaryFa: patch.summaryFa, rootCauseFa: patch.rootCauseFa, diff: applied.diff, validation, ...(applied.branch ? { branch: applied.branch } : {}) };
  try {
    const r = await guard(
      plan,
      deps.ops.approver,
      async () => {
        const commit = await commitPatch(applied as AppliedPatch, `fix: ${patch.summaryFa} (siavash incident ${input.incidentId})`);
        const deploy = input.mode === 'deploy' && deps.redeploy ? await deps.redeploy(input.app, input.root) : undefined;
        return { commit, deploy };
      },
      guardOptions(deps.ops),
    );
    if (r.status !== 'executed') {
      await revertPatch(applied);
      return { status: 'rejected', ...base, messageFa: p.rejected };
    }
    const { commit, deploy } = r.result;
    const deployed = deploy ? deploy.status === 'done' : false;
    return {
      status: input.mode === 'deploy' ? (deployed ? 'deployed' : 'failed') : 'applied',
      ...base,
      ...(commit ? { commit } : {}),
      ...(deploy ? { deploy } : {}),
      ...(deploy && !deployed && deploy.messageFa ? { messageFa: deploy.messageFa } : {}),
    };
  } catch (e) {
    if (e instanceof ApprovalDeniedError) {
      await revertPatch(applied);
      return { status: 'rejected', ...base, messageFa: p.rejected };
    }
    throw e;
  }
}
