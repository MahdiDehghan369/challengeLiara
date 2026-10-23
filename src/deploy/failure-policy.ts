import { parseDeployLine, type DeployStage } from '../liara/cli-parsers.js';
import { isSiavashError } from '../shared/errors.js';

/**
 * Deploy-failure decision table (T5.11), pure. Every failed deploy becomes a `DeployFailure`; its kind
 * picks the route. A timeout is never a failure and never triggers an automatic redeploy.
 */

export type DeployFailureKind = 'preflight' | 'upload' | 'build' | 'timeout' | 'runtime';

export type FailureRoute = 'stop' | 'offer-retry' | 'build-analysis' | 'wait-or-inspect' | 'rollback-first' | 'sre';

export interface DeployFailure {
  /** Pipeline step that failed. */
  stage: string;
  kind: DeployFailureKind;
  isFirstDeploy: boolean;
  /** Ledger id of the last healthy deployment (a rollback target). */
  previousHealthy?: string;
  evidence: string[];
  /** Last deploy output lines (build log), when there are any. */
  tail: string[];
  /** 1-based count of failures in this incident. */
  attempt: number;
  messageFa?: string;
}

/** Upload retries offered per incident. */
export const MAX_UPLOAD_RETRIES = 2;
/** fix → redeploy attempts per incident. */
export const MAX_FIX_ATTEMPTS = 3;

const LATE_STAGES: DeployStage[] = ['build', 'push', 'release'];

function detailsOf(error: unknown): Record<string, unknown> {
  return isSiavashError(error) && error.details && typeof error.details === 'object' ? (error.details as Record<string, unknown>) : {};
}

/** Stages the deploy output reached (the `failed`/`done` markers do not count). */
export function reachedStages(tail: string[]): Set<DeployStage> {
  const out = new Set<DeployStage>();
  for (const l of tail) {
    const st = parseDeployLine(l).stage;
    if (st && st !== 'failed' && st !== 'done') out.add(st);
  }
  return out;
}

export function classifyFailure(input: {
  failedStep: string | undefined;
  error: unknown;
  isFirstDeploy: boolean;
  previousHealthy?: string;
  attempt: number;
  messageFa?: string;
}): DeployFailure {
  const details = detailsOf(input.error);
  const tail = Array.isArray(details.tail) ? (details.tail as string[]) : [];
  const evidence = Array.isArray(details.evidence) ? (details.evidence as string[]) : [];
  const stage = input.failedStep ?? 'unknown';
  let kind: DeployFailureKind;
  if (stage === 'verify') kind = 'runtime';
  else if (stage === 'deploy') {
    if (isSiavashError(input.error) && input.error.retryable && evidence.some((e) => /timeout/.test(e))) kind = 'timeout';
    else if (tail.length === 0 && evidence.length === 0) kind = 'upload'; // network / 5xx before any deploy output
    else kind = [...reachedStages(tail)].some((s) => LATE_STAGES.includes(s)) ? 'build' : 'upload';
  } else kind = 'preflight'; // token, CLI, folder — and any other setup step: stop and explain
  return {
    stage,
    kind,
    isFirstDeploy: input.isFirstDeploy,
    ...(input.previousHealthy ? { previousHealthy: input.previousHealthy } : {}),
    evidence: evidence.length ? evidence : tail.slice(-3),
    tail,
    attempt: input.attempt,
    ...(input.messageFa ? { messageFa: input.messageFa } : {}),
  };
}

export function routeFor(f: DeployFailure, counters: { uploadRetries: number; fixAttempts: number }): FailureRoute {
  switch (f.kind) {
    case 'preflight':
      return 'stop';
    case 'upload':
      return counters.uploadRetries < MAX_UPLOAD_RETRIES ? 'offer-retry' : 'stop';
    case 'build':
      return counters.fixAttempts < MAX_FIX_ATTEMPTS ? 'build-analysis' : 'stop';
    case 'timeout':
      return 'wait-or-inspect';
    case 'runtime':
      if (!f.isFirstDeploy && f.previousHealthy) return 'rollback-first';
      return counters.fixAttempts < MAX_FIX_ATTEMPTS ? 'sre' : 'stop';
  }
}
