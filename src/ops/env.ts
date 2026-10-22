import type { EnvVar } from '../liara/cli-parsers.js';
import type { EnvChangeResult } from '../liara/env.js';
import { guard, type GuardResult } from '../safety/approval.js';
import { escalate, isSecretEnvName, Risk, type ActionPlan } from '../safety/risk.js';
import { maskSecret, Secret } from '../shared/secret.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { fingerprint, guardOptions, newPlanId, type OpsContext } from './context.js';

/** The env backend (implemented by `EnvApi`, T1.8). */
export interface EnvBackend {
  listEnv(app: string): Promise<EnvVar[]>;
  setEnv(app: string, vars: Record<string, string | Secret<string>>): Promise<EnvChangeResult>;
  unsetEnv(app: string, keys: string[]): Promise<EnvChangeResult>;
}

export interface MaskedEnv {
  key: string;
  masked: string;
  isSecret: boolean;
}

/** `list_env` (R0): values masked — secret-named vars fully, others partially. */
export async function listEnvMasked(env: EnvBackend, app: string): Promise<MaskedEnv[]> {
  return (await env.listEnv(app)).map((e) => {
    const isSecret = isSecretEnvName(e.key);
    return { key: e.key, masked: isSecret ? '••••••' : maskSecret(e.value), isSecret };
  });
}

function restartNote(restartsApp: boolean | 'unknown'): string {
  if (restartsApp === true) return fa.opsEnv.restartYes;
  if (restartsApp === false) return fa.opsEnv.restartNo;
  return fa.opsEnv.restartUnknown;
}

export interface EnvPlanOptions {
  reasonFa?: string;
  /** From EnvApi options / BEHAVIOR §2. */
  restartsApp?: boolean | 'unknown';
}

/** Builds the `set_env` plan: masked diff, risk escalated (secret names → R2), undo with previous values. */
export async function planSetEnv(
  env: EnvBackend,
  app: string,
  vars: Record<string, string | Secret<string>>,
  ctx: Pick<OpsContext, 'risk'>,
  opts: EnvPlanOptions = {},
): Promise<{ plan: ActionPlan; changes: Array<{ key: string; change: 'added' | 'changed' }> }> {
  const current = new Map((await env.listEnv(app)).map((e) => [e.key, e.value]));
  const changes: Array<{ key: string; change: 'added' | 'changed' }> = [];
  const previous: Record<string, Secret<string>> = {};
  const fp: Record<string, string> = {};
  for (const [key, v] of Object.entries(vars)) {
    const value = v instanceof Secret ? v.reveal() : v;
    fp[key] = fingerprint(value);
    const prev = current.get(key);
    if (!prev) changes.push({ key, change: 'added' });
    else if (prev.reveal() !== value) {
      changes.push({ key, change: 'changed' });
      previous[key] = prev;
    }
  }
  const added = changes.filter((c) => c.change === 'added').map((c) => c.key);
  const diffFa = changes.map((c) => fa.opsEnv.diffLine(c.key, c.change === 'added' ? fa.opsEnv.added : fa.opsEnv.changed));
  const plan: ActionPlan = escalate(
    {
      id: newPlanId('set-env'),
      toolName: 'set_env',
      titleFa: fa.opsEnv.setTitle(app, changes.length),
      reasonFa: opts.reasonFa ?? fa.opsEnv.defaultReason,
      target: { app },
      risk: Risk.R1,
      impactFa: [...diffFa, restartNote(opts.restartsApp ?? 'unknown')].join('\n'),
      rollbackFa: fa.opsEnv.rollbackSet,
      command: `POST /v1/projects/update-envs  {project: "${app}", variables: [${Object.keys(vars).join(', ')}]}`,
      params: { app, vars: fp, removedCount: 0 },
      undo: {
        tool: 'set_env',
        params: { app, restore: Object.keys(previous), remove: added },
        secretValues: previous,
      },
    },
    ctx.risk ?? {},
  );
  return { plan, changes };
}

/** `set_env`: one approval for the whole batch; nothing runs when values are already equal. */
export async function setEnv(
  env: EnvBackend,
  app: string,
  vars: Record<string, string | Secret<string>>,
  ctx: OpsContext,
  opts: EnvPlanOptions = {},
): Promise<GuardResult<EnvChangeResult> | { status: 'no-change'; messageFa: string }> {
  const { plan, changes } = await planSetEnv(env, app, vars, ctx, opts);
  if (changes.length === 0) return { status: 'no-change', messageFa: fa.opsEnv.noChange };
  return guard(plan, ctx.approver, () => env.setEnv(app, vars), guardOptions(ctx));
}

/** `unset_env` (R3): previous values kept for undo in the secure file. */
export async function unsetEnv(
  env: EnvBackend,
  app: string,
  keys: string[],
  ctx: OpsContext,
  opts: EnvPlanOptions = {},
): Promise<GuardResult<EnvChangeResult> | { status: 'no-change'; messageFa: string }> {
  const current = new Map((await env.listEnv(app)).map((e) => [e.key, e.value]));
  const existing = keys.filter((k) => current.has(k));
  if (existing.length === 0) return { status: 'no-change', messageFa: fa.opsEnv.noChange };
  const previous = Object.fromEntries(existing.map((k) => [k, current.get(k) as Secret<string>]));
  const plan: ActionPlan = escalate(
    {
      id: newPlanId('unset-env'),
      toolName: 'unset_env',
      titleFa: fa.opsEnv.unsetTitle(app, existing.length),
      reasonFa: opts.reasonFa ?? fa.opsEnv.defaultReason,
      target: { app },
      risk: Risk.R3,
      impactFa: [
        ...existing.map((k) => fa.opsEnv.diffLine(k, fa.opsEnv.removed)),
        restartNote(opts.restartsApp ?? 'unknown'),
      ].join('\n'),
      rollbackFa: fa.opsEnv.rollbackUnset,
      command: `liara env:unset ${existing.join(' ')} -a ${app} -f`,
      params: { app, keys: existing },
      undo: { tool: 'set_env', params: { app, restore: existing }, secretValues: previous },
    },
    ctx.risk ?? {},
  );
  return guard(plan, ctx.approver, () => env.unsetEnv(app, existing), guardOptions(ctx));
}
