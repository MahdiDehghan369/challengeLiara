import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { createSourceArchive } from '../liara/archive.js';
import type { CreateReleaseInput, ReleaseOutcome, ReleaseSignal, UploadProgress } from '../liara/api/deploy.js';
import type { DeployEvent, DeployOptions } from '../liara/cli.js';
import type { DeploymentLedger, DeploymentRecord } from '../liara/ledger.js';
import { guard, type GuardResult } from '../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../safety/risk.js';
import { ValidationError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import { relTimeFa } from '../shared/time.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { guardOptions, newPlanId, type OpsContext } from './context.js';

export interface DeploymentView extends DeploymentRecord {
  whenFa: string;
}

/** `list_deployments` (R0): ledger records, newest first, with Persian relative time. */
export function listDeployments(ledger: DeploymentLedger, app: string, now = Date.now()): DeploymentView[] {
  return ledger
    .list(app)
    .reverse()
    .map((r) => ({ ...r, whenFa: relTimeFa(r.startedAt, now) }));
}

/** Deploy surface used by rollback (implemented by DeployApi). */
export interface RollbackDeployApi {
  uploadSource(name: string, archivePath: string, onProgress?: UploadProgress): Promise<string>;
  createRelease(name: string, input: CreateReleaseInput): Promise<string>;
  waitForRelease(
    name: string,
    releaseID: string,
    opts: { signals: ReleaseSignal[]; timeoutMs?: number },
  ): Promise<ReleaseOutcome>;
}

export interface RollbackCli {
  deploy(opts: DeployOptions): AsyncIterable<DeployEvent>;
}

/** Checks out `commit` into a throwaway git worktree, runs `fn`, and always removes the worktree. */
export async function withWorktree<T>(repoDir: string, commit: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const git = simpleGit(repoDir);
  const dir = join(mkdtempSync(join(tmpdir(), 'siavash-wt-')), 'src');
  await git.raw(['worktree', 'add', '--detach', dir, commit]);
  try {
    return await fn(dir);
  } finally {
    try {
      await git.raw(['worktree', 'remove', '--force', dir]);
    } catch (e) {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, 'worktree remove failed');
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export type RollbackMethod = 'source' | 'git-api' | 'git-cli';

export interface RollbackDeps {
  ledger: DeploymentLedger;
  deploy: RollbackDeployApi;
  cli?: RollbackCli;
  /** Project git repo (needed for methods 2 and 3). */
  repoDir?: string;
  /**
   * Whether a new release can reuse an old `sourceID` (BEHAVIOR §4 / OQ-22).
   * 'unknown' → try it and fall back to git on failure.
   */
  sourceReuse?: 'supported' | 'unsupported' | 'unknown';
  /** Signals that decide when the new release is live (see DeployApi.waitForRelease). */
  releaseSignals?: ReleaseSignal[];
  /** Post-rollback verification (T8.10); its verdict is recorded on the new deployment. */
  verify?: (app: string) => Promise<{ score: number; verdict: string }>;
}

export interface RollbackTarget {
  current: DeploymentRecord | undefined;
  target: DeploymentRecord;
  methods: RollbackMethod[];
}

/** Picks the target (explicit id or last healthy) and the available methods in strategy order. */
export function resolveRollback(deps: RollbackDeps, app: string, targetId?: string): RollbackTarget {
  const current = deps.ledger.latest(app);
  const target = targetId
    ? deps.ledger.list(app).find((r) => r.id === targetId)
    : deps.ledger.previousHealthy(app, current?.id);
  if (!target) throw new ValidationError(`No rollback target for ${app}`, { messageFa: fa.rollback.noTarget });
  const methods: RollbackMethod[] = [];
  if (target.sourceID && deps.sourceReuse !== 'unsupported') methods.push('source');
  if (target.gitCommit && deps.repoDir) {
    methods.push('git-api');
    if (deps.cli) methods.push('git-cli');
  }
  if (methods.length === 0) throw new ValidationError(`No rollback method for ${app}`, { messageFa: fa.rollback.noMethod });
  return { current, target, methods };
}

const METHOD_FA: Record<RollbackMethod, string> = {
  source: fa.rollback.methodSource,
  'git-api': fa.rollback.methodGitApi,
  'git-cli': fa.rollback.methodGitCli,
};

export function planRollback(app: string, t: RollbackTarget, ctx: Pick<OpsContext, 'risk'>, reasonFa?: string, now = Date.now()): ActionPlan {
  const describe = (r: DeploymentRecord) => fa.rollback.describe(r.id, relTimeFa(r.startedAt, now), r.gitCommit);
  return escalate(
    {
      id: newPlanId('rollback'),
      toolName: 'rollback_app',
      titleFa: fa.rollback.title(app),
      reasonFa: reasonFa ?? fa.rollback.defaultReason,
      target: { app },
      risk: Risk.R2,
      impactFa: fa.rollback.impact(t.current ? describe(t.current) : '—', describe(t.target), METHOD_FA[t.methods[0] as RollbackMethod]),
      rollbackFa: fa.rollback.rollbackFa,
      command:
        t.methods[0] === 'source'
          ? `POST /v2/projects/${app}/releases {sourceID: "${t.target.sourceID}", port: ${t.target.port}, type: "${t.target.platform}"}`
          : `git worktree add ${t.target.gitCommit?.slice(0, 7)} → ${t.methods[0] === 'git-api' ? 'POST /v2/projects/{name}/sources + releases' : 'liara deploy'}`,
      params: { app, targetId: t.target.id, methods: t.methods },
    },
    ctx.risk ?? {},
  );
}

export interface RollbackResult {
  method: RollbackMethod;
  record: DeploymentRecord;
  outcome: ReleaseOutcome | undefined;
  attempts: Array<{ method: RollbackMethod; error?: string }>;
}

async function runMethod(deps: RollbackDeps, app: string, target: DeploymentRecord, method: RollbackMethod): Promise<Partial<DeploymentRecord>> {
  const port = target.port ?? 3000;
  const type = target.platform ?? 'node';
  if (method === 'source') {
    const releaseID = await deps.deploy.createRelease(app, { sourceID: target.sourceID as string, port, type });
    return { mode: 'api', sourceID: target.sourceID, releaseID };
  }
  return withWorktree(deps.repoDir as string, target.gitCommit as string, async (dir) => {
    if (method === 'git-api') {
      const archive = await createSourceArchive(dir);
      const sourceID = await deps.deploy.uploadSource(app, archive.path);
      const releaseID = await deps.deploy.createRelease(app, { sourceID, port, type });
      return { mode: 'api' as const, sourceID, releaseID, archiveSha256: archive.sha256 };
    }
    let version: string | undefined;
    for await (const ev of (deps.cli as RollbackCli).deploy({ cwd: dir, app, port, platform: type, message: `rollback to ${target.id}` })) {
      if (ev.type === 'done') version = ev.version;
      if (ev.type === 'failed') throw new Error(`cli deploy failed (exit ${ev.exitCode ?? 'timeout'})`);
    }
    return { mode: 'cli' as const, ...(version ? { version } : {}) };
  });
}

/** `rollback_app` (R2): approval → try methods in order → ledger (`rollbackOf`, replaced one `rolled-back`) → verify. */
export async function rollbackApp(
  deps: RollbackDeps,
  app: string,
  ctx: OpsContext,
  opts: { targetId?: string; reasonFa?: string } = {},
): Promise<GuardResult<RollbackResult>> {
  const t = resolveRollback(deps, app, opts.targetId);
  const plan = planRollback(app, t, ctx, opts.reasonFa);
  return guard(
    plan,
    ctx.approver,
    async () => {
      const attempts: RollbackResult['attempts'] = [];
      for (const method of t.methods) {
        try {
          const fields = await runMethod(deps, app, t.target, method);
          const rec = deps.ledger.record({
            app,
            mode: fields.mode ?? 'api',
            ...fields,
            ...(t.target.gitCommit ? { gitCommit: t.target.gitCommit } : {}),
            ...(t.target.port === undefined ? {} : { port: t.target.port }),
            ...(t.target.platform ? { platform: t.target.platform } : {}),
            message: `rollback to ${t.target.id}`,
            rollbackOf: t.target.id,
          });
          attempts.push({ method });
          let outcome: ReleaseOutcome | undefined;
          if (fields.releaseID && deps.releaseSignals?.length) {
            outcome = await deps.deploy.waitForRelease(app, fields.releaseID, { signals: deps.releaseSignals });
          }
          const result = outcome ? (outcome.result === 'success' ? 'success' : outcome.result) : fields.mode === 'cli' ? 'success' : 'pending';
          let record = deps.ledger.update(app, rec.id, { result });
          if (t.current && t.current.id !== t.target.id) deps.ledger.update(app, t.current.id, { result: 'rolled-back' });
          if (deps.verify && result === 'success') {
            record = deps.ledger.update(app, rec.id, { healthAfter: await deps.verify(app) });
          }
          return { method, record, outcome, attempts };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          attempts.push({ method, error: msg });
          logger.warn({ app, method, err: msg }, 'rollback method failed; trying next');
        }
      }
      throw new ValidationError(`All rollback methods failed for ${app}`, {
        messageFa: fa.rollback.noMethod,
        details: { attempts },
      });
    },
    guardOptions(ctx),
  );
}
