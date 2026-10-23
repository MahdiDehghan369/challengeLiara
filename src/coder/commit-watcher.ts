import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { listFiles } from '../analyzer/project-files.js';

/**
 * Handoff signals (T8.15): a new commit on the project's HEAD (polled), a `report_fix_done` call (the MCP
 * tool notifies `FixDoneSignals`), or — without git — a content hash of the project files.
 */

export const COMMIT_POLL_MS = 5000;

export interface CommitInfo {
  commit: string;
  message: string;
}

export const isGitRepo = (root: string): boolean => existsSync(join(root, '.git'));

export async function headCommit(root: string): Promise<CommitInfo | undefined> {
  try {
    const git = simpleGit(root);
    const log = await git.log({ maxCount: 1 });
    return log.latest ? { commit: log.latest.hash, message: log.latest.message } : undefined;
  } catch {
    return undefined;
  }
}

export interface WaitCommitOptions {
  /** HEAD to compare against (default: HEAD when the wait starts). */
  since?: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

/** Resolves with the first commit that differs from `since`; undefined on timeout or abort. */
export async function waitForNewCommit(root: string, opts: WaitCommitOptions = {}): Promise<CommitInfo | undefined> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const since = opts.since ?? (await headCommit(root))?.commit;
  const deadline = opts.timeoutMs === undefined ? Infinity : Date.now() + opts.timeoutMs;
  while (!opts.signal?.aborted && Date.now() < deadline) {
    const head = await headCommit(root);    if (head && head.commit !== since) return head;
    await sleep(opts.intervalMs ?? COMMIT_POLL_MS);
  }
  return undefined;
}

/** Hash of the project's files (no git): changes when any file changes. `.siavash/` is ignored. */
export function projectHash(root: string): string {
  const h = createHash('sha256');
  for (const rel of listFiles(root).filter((f) => !f.startsWith('.siavash/')).sort()) {
    h.update(rel);
    h.update('\0');
    h.update(readFileSync(join(root, rel)));
    h.update('\0');
  }
  return h.digest('hex');
}

/** `report_fix_done({incidentId, commit?})` from the MCP side resolves the matching wait. */
export class FixDoneSignals {
  private readonly waiters = new Map<string, Array<(r: { commit?: string }) => void>>();

  wait(incidentId: string, signal?: AbortSignal): Promise<{ commit?: string } | undefined> {
    return new Promise((resolve) => {
      const list = this.waiters.get(incidentId) ?? [];
      list.push(resolve);
      this.waiters.set(incidentId, list);
      signal?.addEventListener('abort', () => resolve(undefined), { once: true });
    });
  }

  /** True when someone was waiting for this incident. */
  notify(incidentId: string, commit?: string): boolean {
    const list = this.waiters.get(incidentId);
    if (!list?.length) return false;
    this.waiters.delete(incidentId);
    for (const r of list) r(commit ? { commit } : {});
    return true;
  }
}
