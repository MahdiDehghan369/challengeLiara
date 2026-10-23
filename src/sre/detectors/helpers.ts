import type { AppEvent } from '../../liara/index.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { ProbeResult } from '../health.js';
import type { LogRecord } from '../logs.js';
import type { Snapshot } from '../snapshot.js';
import type { LogRef, Severity, Signal, SignalEvidence } from './types.js';

/** Safe accessors: a failed source simply yields nothing, so detectors never fire on missing data. */
export const logsOf = (s: Snapshot): LogRecord[] => (s.sources.logs.ok ? s.sources.logs.value : []);
export const eventsOf = (s: Snapshot): AppEvent[] => (s.sources.events.ok ? s.sources.events.value : []);
export const probeOf = (s: Snapshot): ProbeResult | undefined => (s.sources.probe.ok ? s.sources.probe.value : undefined);
export const appOf = (s: Snapshot) => (s.sources.app.ok ? s.sources.app.value : undefined);

const SNIPPET_MAX = 240;

export function ref(r: LogRecord): LogRef {
  return { ts: r.ts, snippet: r.text.split('\n').slice(0, 3).join('\n').slice(0, SNIPPET_MAX) };
}

/** Records matching `re` (first 3 kept as evidence) and the first capture group, if any. */
export function matchLogs(s: Snapshot, re: RegExp): { records: LogRecord[]; capture: string | undefined } {
  const records = logsOf(s).filter((r) => re.test(r.text));
  let capture: string | undefined;
  for (const r of records) {
    const m = re.exec(r.text);
    if (m?.[1]) {
      capture = m[1];
      break;
    }
  }
  return { records, capture };
}

export function signal(id: string, severity: Severity, evidence: SignalEvidence, detail?: string): Signal {
  return { id, severity, titleFa: fa.detectors[id] ?? id, evidence, ...(detail ? { detail } : {}) };
}

export function logSignal(id: string, severity: Severity, s: Snapshot, re: RegExp): Signal[] {
  const { records, capture } = matchLogs(s, re);
  return records.length ? [signal(id, severity, { logRefs: records.slice(0, 3).map(ref) }, capture)] : [];
}

/** Share of probe samples with a 5xx status. */
export function fiveXxShare(p: ProbeResult): number {
  const fiveXx = Object.entries(p.statusHistogram)
    .filter(([code]) => code.startsWith('5'))
    .reduce((n, [, c]) => n + c, 0);
  return p.total ? fiveXx / p.total : 0;
}
