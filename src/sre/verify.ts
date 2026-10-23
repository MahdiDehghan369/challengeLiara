import { round } from '../shared/stats.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { runDetectors, type Signal } from './detectors/index.js';
import { fiveXxShare } from './detectors/helpers.js';
import type { Hypothesis } from './rca.js';
import { takeSnapshot, type Snapshot, type SnapshotDeps } from './snapshot.js';

/**
 * Verify loop (T8.10): after a fix, wait for the app to settle, take a few snapshots and compare them
 * with the baseline. Verdict resolved / improved / unchanged / worse, a before/after table for the UI
 * and the report, and the next step (undo on worse, next hypothesis on unchanged, ≤ 3 rounds).
 */

export type FixVerdict = 'resolved' | 'improved' | 'unchanged' | 'worse';
export const MAX_FIX_ROUNDS = 3;

export interface Measures {
  availability: number | undefined;
  errorRate: number | undefined;
  p95: number | undefined;
  /** Memory % of plan when known, else the raw current value. */
  memory: number | undefined;
  critical: number;
  /** Target signals still present. */
  targets: string[];
}

export interface ComparisonRow {
  key: keyof Omit<Measures, 'targets'> | 'target';
  labelFa: string;
  before: string;
  after: string;
  /** true = better, false = worse, undefined = same / unknown. */
  better: boolean | undefined;
}

export interface VerifyFixResult {
  verdict: FixVerdict;
  verdictFa: string;
  before: Measures;
  after: Measures;
  table: ComparisonRow[];
  signalsAfter: Signal[];
  next: 'done' | 'watch' | 'undo' | 'next-hypothesis' | 'give-up';
  nextFa: string;
  snapshotsTaken: number;
}

export interface VerifyFixOptions {
  windowSec?: number;
  /** Wait before the first snapshot (default 30 s). */
  settleMs?: number;
  snapshots?: number;
  /** Between snapshots (default 30 s). */
  intervalMs?: number;
  /** 1-based round of the doctor loop (for give-up after MAX_FIX_ROUNDS). */
  round?: number;
  /** When the fix was applied (ms): older logs/events are not held against it. Default: call time. */
  fixedAt?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export function measure(s: Snapshot, signals: Signal[], targets: string[]): Measures {
  const p = s.sources.probe.ok ? s.sources.probe.value : undefined;
  const mem = s.sources.metrics.ok ? s.sources.metrics.value.memory.applets[0] : undefined;
  const ids = new Set(signals.map((x) => x.id));
  return {
    availability: p?.availability,
    errorRate: p && p.total ? round(fiveXxShare(p) * 100, 1) : undefined,
    p95: p?.p95,
    memory: mem ? (mem.percent.current ?? mem.stats.current) : undefined,
    critical: signals.filter((x) => x.severity === 'critical').length,
    targets: targets.filter((t) => ids.has(t)),
  };
}

/** Targets of a hypothesis: its signals, or every critical signal of the baseline. */
export function targetSignals(h: Pick<Hypothesis, 'signalIds'> | undefined, baselineSignals: Signal[]): string[] {
  if (h?.signalIds?.length) return h.signalIds.filter((id) => baselineSignals.some((s) => s.id === id));
  return baselineSignals.filter((s) => s.severity === 'critical').map((s) => s.id);
}

const fmt = (v: number | undefined) => (v === undefined ? '—' : String(round(v, 1)));

function compare(before: number | undefined, after: number | undefined, higherIsBetter: boolean, tolerance: number): boolean | undefined {
  if (before === undefined || after === undefined || Math.abs(after - before) <= tolerance) return undefined;
  return higherIsBetter ? after > before : after < before;
}

export function compareMeasures(before: Measures, after: Measures): { verdict: FixVerdict; table: ComparisonRow[] } {
  const m = fa.verifyFix.metric;
  const rows: ComparisonRow[] = [
    { key: 'availability', labelFa: m.availability!, before: fmt(before.availability), after: fmt(after.availability), better: compare(before.availability, after.availability, true, 5) },
    { key: 'errorRate', labelFa: m.errorRate!, before: fmt(before.errorRate), after: fmt(after.errorRate), better: compare(before.errorRate, after.errorRate, false, 5) },
    { key: 'p95', labelFa: m.p95!, before: fmt(before.p95), after: fmt(after.p95), better: compare(before.p95, after.p95, false, Math.max(50, (before.p95 ?? 0) * 0.2)) },
    { key: 'memory', labelFa: m.memory!, before: fmt(before.memory), after: fmt(after.memory), better: compare(before.memory, after.memory, false, Math.max(1, (before.memory ?? 0) * 0.1)) },
    { key: 'critical', labelFa: m.critical!, before: String(before.critical), after: String(after.critical), better: compare(before.critical, after.critical, false, 0) },
  ];
  if (before.targets.length > 0) {
    rows.push({
      key: 'target',
      labelFa: m.target!,
      before: before.targets.join(', '),
      after: after.targets.length ? after.targets.join(', ') : fa.verifyFix.absent,
      better: after.targets.length < before.targets.length ? true : after.targets.length > before.targets.length ? false : undefined,
    });
  }

  const targetsGone = before.targets.length > 0 ? after.targets.length === 0 : after.critical === 0;
  // a target can "disappear" because the app stopped answering at all: user-facing numbers decide first
  const worse = after.critical > before.critical || rows.some((r) => (r.key === 'availability' || r.key === 'errorRate') && r.better === false);
  let verdict: FixVerdict;
  if (worse) verdict = 'worse';
  else if (targetsGone && after.critical === 0) verdict = 'resolved';
  else if (rows.some((r) => r.better === true)) verdict = 'improved';
  else verdict = 'unchanged';
  return { verdict, table: rows };
}

/** The snapshot without logs/events from before `fixedAt` (they describe the old state). */
export function sinceFix(s: Snapshot, fixedAt: number): Snapshot {
  const src = s.sources;
  return {
    ...s,
    sources: {
      ...src,
      logs: src.logs.ok ? { ...src.logs, value: src.logs.value.filter((r) => r.ts >= fixedAt) } : src.logs,
      events: src.events.ok ? { ...src.events, value: src.events.value.filter((e) => e.ts === undefined || e.ts >= fixedAt) } : src.events,
    },
  };
}

export async function verifyFix(
  app: string,
  baseline: Snapshot,
  hypothesis: Pick<Hypothesis, 'signalIds'> | undefined,
  deps: SnapshotDeps,
  opts: VerifyFixOptions = {},
): Promise<VerifyFixResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const fixedAt = opts.fixedAt ?? (opts.now ?? Date.now)();
  const baseSignals = runDetectors(baseline);
  const targets = targetSignals(hypothesis, baseSignals);
  const before = measure(baseline, baseSignals, targets);

  await sleep(opts.settleMs ?? 30_000);
  const n = Math.max(1, opts.snapshots ?? 2);
  let last: Snapshot | undefined;
  let lastSignals: Signal[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) await sleep(opts.intervalMs ?? 30_000);
    last = sinceFix(await takeSnapshot(app, opts.windowSec ?? 120, deps), fixedAt);
    lastSignals = runDetectors(last);
  }
  const after = measure(last as Snapshot, lastSignals, targets);
  const { verdict, table } = compareMeasures(before, after);

  const v = fa.verifyFix;
  const roundNo = opts.round ?? 1;
  const next: VerifyFixResult['next'] =
    verdict === 'resolved' ? 'done' : verdict === 'improved' ? 'watch' : verdict === 'worse' ? 'undo' : roundNo >= MAX_FIX_ROUNDS ? 'give-up' : 'next-hypothesis';
  const nextFa = { done: v.done, watch: v.keepWatching, undo: v.nextUndo, 'next-hypothesis': v.nextHypothesis, 'give-up': v.giveUp }[next];
  return { verdict, verdictFa: v.verdict[verdict] ?? verdict, before, after, table, signalsAfter: lastSignals, next, nextFa, snapshotsTaken: n };
}
