import { readProjectState, writeProjectState } from '../agent/project-state.js';
import { MAX_FIX_ATTEMPTS } from '../deploy/failure-policy.js';
import type { CodeFixRequest, CodeFixRouter } from '../sre/execute-fix.js';
import { createIncident } from '../sre/incident.js';
import { CANCELLED, type Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { headCommit, isGitRepo, projectHash, waitForNewCommit, type CommitInfo, type FixDoneSignals } from './commit-watcher.js';
import { deliverFixBrief } from './fix-brief.js';
import { runValidation, type RunValidationOptions, type ValidationResult } from './validate.js';

/**
 * Code-fix modes (T8.15), used wherever the cause is code (doctor, build doctor): `self` (T8.9),
 * `handoff` (Fix Brief → wait for a commit / `report_fix_done` → validate → redeploy; a failed check
 * sends a new brief with the new error) or `report` (incident report only). The choice is remembered
 * in `.siavash/project.json`. In handoff mode the agent never edits project files.
 */

export type FixMode = 'self' | 'handoff' | 'report';
export const FIX_MODES: readonly FixMode[] = ['self', 'handoff', 'report'];

export type FixStatus = 'deployed' | 'applied' | 'waiting-fix' | 'reported' | 'gave-up' | 'failed' | 'skipped';

export interface FixRouterDeps {
  root: string;
  ui: Prompter;
  /** T8.9 path (normally `runCodePatch`). */
  self: (req: CodeFixRequest) => Promise<{ status: string; messageFa?: string }>;
  /** `redeploy_app` after a handed-off fix (its own R1 card). */
  redeploy: (app: string, root: string) => Promise<{ status: string; messageFa?: string }>;
  validation?: RunValidationOptions;
  /** `report_fix_done` notifications (MCP). */
  signals?: FixDoneSignals;
  watch?: { intervalMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> };
  copy?: (text: string) => Promise<boolean>;
  /** Brief extras. */
  endpoint?: string;
  envNames?: string[];
  knownSecrets?: string[];
  signal?: AbortSignal;
  /** Skip the question (e.g. MCP: the user's agent is the one asking → handoff). */
  forceMode?: FixMode;
  /** false: deliver the brief and return `waiting-fix` at once (MCP: `report_fix_done` comes later). */
  wait?: boolean;
  /** Called with every brief written (the MCP incident book). */
  onBrief?: (req: CodeFixRequest, briefPath: string, markdown: string) => void;
}

export interface HandoffRound {
  round: number;
  briefPath: string;
  commit?: string;
  validation?: Pick<ValidationResult, 'ok' | 'skipped'>;
}

const h = fa.handoff;

/** Saved mode → one confirmation; otherwise the three options. The choice is saved. */
export async function chooseFixMode(root: string, ui: Prompter): Promise<FixMode | undefined> {
  const saved = readProjectState(root)?.fixMode;
  if (saved) {
    const ok = await ui.select(h.confirmSaved(h.mode[saved] as string), [
      { value: 'yes', label: h.yes },
      { value: 'change', label: h.change },
    ]);
    if (ok === CANCELLED) return undefined;
    if (ok === 'yes') return saved;
  }
  const picked = await ui.select(h.choose, FIX_MODES.map((m) => ({ value: m, label: h.mode[m] as string })));
  if (picked === CANCELLED) return undefined;
  writeProjectState(root, { fixMode: picked });
  return picked;
}

function failureText(v: ValidationResult): string {
  return v.steps
    .filter((s) => !s.ok)
    .map((s) => `$ ${s.command}\n${s.outputTail}`)
    .join('\n\n');
}

/** Waits for the user's agent: a new commit or `report_fix_done` (git), or Enter + a changed file hash. */
async function waitForFix(deps: FixRouterDeps, incidentId: string): Promise<CommitInfo | 'changed' | undefined> {
  if (!isGitRepo(deps.root)) {
    const before = projectHash(deps.root);
    const r = await deps.ui.text(h.pressEnter);
    if (r === CANCELLED) return undefined;
    if (projectHash(deps.root) === before) {
      deps.ui.note(h.noChange, h.title);
      return undefined;
    }
    return 'changed';
  }
  const since = (await headCommit(deps.root))?.commit;
  const ac = new AbortController();
  deps.signal?.addEventListener('abort', () => ac.abort(), { once: true });
  deps.ui.note(h.waiting, h.title);
  const got = await Promise.race([
    waitForNewCommit(deps.root, { ...(since ? { since } : {}), ...deps.watch, signal: ac.signal }),
    ...(deps.signals ? [deps.signals.wait(incidentId, ac.signal).then(async (r) => (r ? ((await headCommit(deps.root)) ?? { commit: r.commit ?? '', message: '' }) : undefined))] : []),
  ]);
  ac.abort();
  return got;
}

export async function runHandoff(deps: FixRouterDeps, req: CodeFixRequest): Promise<{ status: FixStatus; messageFa?: string; rounds: HandoffRound[] }> {
  const rounds: HandoffRound[] = [];
  const incident = createIncident({ app: req.app, kind: 'runtime', signals: [], hypotheses: [req.hypothesis], id: req.incidentId });
  let error = req.error;
  for (let round = 1; round <= MAX_FIX_ATTEMPTS; round++) {
    const brief = await deliverFixBrief(
      deps.root,
      {
        incident,
        hypothesis: req.hypothesis,
        error,
        ...(deps.endpoint ? { endpoint: deps.endpoint } : {}),
        ...(deps.envNames ? { envNames: deps.envNames } : {}),
        ...(deps.knownSecrets ? { knownSecrets: deps.knownSecrets } : {}),
      },
      deps.ui,
      deps.copy ? { copy: deps.copy } : {},
    );
    const r: HandoffRound = { round, briefPath: brief.path };
    rounds.push(r);
    deps.onBrief?.(req, brief.path, brief.markdown);
    if (deps.wait === false) return { status: 'waiting-fix', messageFa: h.stillWaiting, rounds };

    const got = await waitForFix(deps, req.incidentId);
    if (!got) return { status: 'waiting-fix', messageFa: h.stillWaiting, rounds };
    if (got !== 'changed') {
      r.commit = got.commit;
      const go = await deps.ui.select(h.newCommit(got.message.split('\n')[0] ?? ''), [
        { value: 'go', label: h.checkAndDeploy },
        { value: 'later', label: h.later },
      ]);
      if (go !== 'go') return { status: 'waiting-fix', messageFa: h.stillWaiting, rounds };
    }

    const v = await runValidation(deps.root, deps.validation);
    r.validation = { ok: v.ok, skipped: v.skipped };
    if (!v.ok) {
      // round 2+: a new brief with the new error
      deps.ui.note(h.validationFailed(round), h.title);
      error = [req.error.split('\n')[0] ?? '', '', 'The previous fix did not pass local validation:', failureText(v)].join('\n');
      continue;
    }
    const d = await deps.redeploy(req.app, deps.root);
    return d.status === 'done' ? { status: 'deployed', rounds } : { status: 'failed', ...(d.messageFa ? { messageFa: d.messageFa } : {}), rounds };
  }
  return { status: 'gave-up', messageFa: h.capReached(MAX_FIX_ATTEMPTS), rounds };
}

/** The `CodeFixRouter` the doctor / deploy-failure machine call. */
export function createFixRouter(deps: FixRouterDeps): CodeFixRouter & { lastRounds: HandoffRound[] } {
  const router = {
    lastRounds: [] as HandoffRound[],
    fix: async (req: CodeFixRequest): Promise<{ status: string; messageFa?: string }> => {
      const mode = deps.forceMode ?? (await chooseFixMode(deps.root, deps.ui));
      if (!mode) return { status: 'skipped' };
      if (mode === 'self') return deps.self(req);
      if (mode === 'report') {
        deps.ui.note(h.reportOnly, h.title);
        return { status: 'reported', messageFa: h.reportOnly };
      }
      const r = await runHandoff(deps, req);
      router.lastRounds = r.rounds;
      return { status: r.status, ...(r.messageFa ? { messageFa: r.messageFa } : {}) };
    },
  };
  return router;
}
