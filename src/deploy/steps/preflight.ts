import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { simpleGit } from 'simple-git';
import type { Config } from '../../config/env.js';
import type { LiaraClient } from '../../liara/index.js';
import { ValidationError, isSiavashError } from '../../shared/errors.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { PipelineState, Step } from '../pipeline-engine.js';

/**
 * Preflight (T5.2): checks that cost nothing and change nothing, before any Liara resource is touched.
 * Every finding says what happened and what to do (Persian). Blockers stop the pipeline.
 */

export type PreflightCheckId = 'token' | 'team' | 'cli' | 'project' | 'git' | 'liaraignore';

export interface PreflightCheck {
  id: PreflightCheckId;
  severity: 'ok' | 'info' | 'warning' | 'blocker';
  whatFa: string;
  fixFa?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

export interface PreflightDeps {
  liara: Pick<LiaraClient, 'account' | 'cli'>;
  config: Pick<Config, 'liara' | 'deployMode'>;
  projectPath: string;
  /** The CLI is needed for `DEPLOY_MODE=cli` and for plan:list (T4.6); default true. */
  needCli?: boolean;
}

const check = (id: PreflightCheckId, severity: PreflightCheck['severity'], whatFa: string, fixFa?: string): PreflightCheck => ({
  id,
  severity,
  whatFa,
  ...(fixFa ? { fixFa } : {}),
});

async function tokenCheck(deps: PreflightDeps): Promise<PreflightCheck> {
  if (deps.config.liara.mode === 'live' && !deps.config.liara.token) {
    return check('token', 'blocker', fa.preflight.tokenMissing, fa.preflight.tokenFix);
  }
  try {
    const me = await deps.liara.account.getMe();
    return me.tokenValid
      ? check('token', 'ok', fa.preflight.tokenOk(me.appCount))
      : check('token', 'blocker', fa.preflight.tokenInvalid, fa.preflight.tokenFix);
  } catch (e) {
    const msg = isSiavashError(e) ? e.messageFa : e instanceof Error ? e.message : String(e);
    return check('token', 'blocker', fa.preflight.tokenError(msg), fa.preflight.tokenErrorFix);
  }
}

function teamCheck(deps: PreflightDeps): PreflightCheck {
  // TODO(OQ-30): no team-list endpoint in the API map, so "several teams → ask" cannot be checked.
  const team = deps.config.liara.teamId;
  return team ? check('team', 'info', fa.preflight.teamSet(team)) : check('team', 'info', fa.preflight.teamPersonal, fa.preflight.teamFix);
}

async function cliCheck(deps: PreflightDeps): Promise<PreflightCheck | undefined> {
  if (deps.needCli === false && deps.config.deployMode !== 'cli') return undefined;
  const info = await deps.liara.cli.ensureCli();
  if (!info.available) return check('cli', 'blocker', fa.preflight.cliMissing, fa.cli.notInstalled);
  return info.viaNpx ? check('cli', 'warning', fa.preflight.cliOk(info.version), info.hintFa) : check('cli', 'ok', fa.preflight.cliOk(info.version));
}

function projectCheck(path: string): PreflightCheck {
  try {
    if (statSync(path).isDirectory()) return check('project', 'ok', fa.preflight.projectOk);
  } catch {
    // missing
  }
  return check('project', 'blocker', fa.preflight.projectMissing(path), fa.preflight.projectFix);
}

async function gitCheck(path: string): Promise<PreflightCheck> {
  try {
    const git = simpleGit(path);
    // only a repo rooted at the project (not a parent repo) counts
    if (!(await git.checkIsRepo()) || !existsSync(join(path, '.git'))) return check('git', 'info', fa.preflight.gitNone);
    const status = await git.status();
    return status.files.length > 0
      ? check('git', 'warning', fa.preflight.gitDirty(status.files.length), fa.preflight.gitDirtyFix)
      : check('git', 'ok', fa.preflight.gitClean);
  } catch {
    return check('git', 'info', fa.preflight.gitNone);
  }
}

function liaraignoreCheck(path: string): PreflightCheck {
  return existsSync(join(path, '.liaraignore'))
    ? check('liaraignore', 'ok', fa.preflight.liaraignoreOk)
    : check('liaraignore', 'warning', fa.preflight.liaraignoreMissing, fa.preflight.liaraignoreFix);
}

export async function runPreflight(deps: PreflightDeps): Promise<PreflightResult> {
  const path = resolve(deps.projectPath);
  const project = projectCheck(path);
  const checks: PreflightCheck[] = [await tokenCheck(deps), teamCheck(deps)];
  const cli = await cliCheck(deps);
  if (cli) checks.push(cli);
  checks.push(project);
  if (project.severity !== 'blocker') checks.push(await gitCheck(path), liaraignoreCheck(path));
  return { ok: checks.every((c) => c.severity !== 'blocker'), checks };
}

/** Persian "what happened + what to do" for the blockers. */
export function preflightFailureFa(result: PreflightResult): string {
  return fa.preflight.failed(
    result.checks
      .filter((c) => c.severity === 'blocker')
      .map((c) => fa.preflight.line(c.whatFa, c.fixFa))
      .join('\n'),
  );
}

export interface PreflightState extends PipelineState {
  preflight?: PreflightResult;
}

export function preflightStep<S extends PreflightState>(deps: PreflightDeps): Step<S> {
  return {
    id: 'preflight',
    titleFa: fa.preflight.title,
    onFail: 'abort',
    run: async (ctx) => {
      const result = await runPreflight(deps);
      ctx.state.preflight = result;
      if (!result.ok) {
        throw new ValidationError('preflight failed', {
          messageFa: preflightFailureFa(result),
          details: { blockers: result.checks.filter((c) => c.severity === 'blocker').map((c) => c.id) },
        });
      }
    },
  };
}
