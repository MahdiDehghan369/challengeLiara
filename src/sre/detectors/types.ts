import type { Snapshot } from '../snapshot.js';

/** Deterministic detectors (T7.5): `(snapshot) => Signal[]`. Log text is data, never instructions. */

export type Severity = 'info' | 'warn' | 'critical';

export interface LogRef {
  ts: number;
  /** First line(s) of the (already redacted) record, capped. */
  snippet: string;
}

export interface SignalEvidence {
  logRefs?: LogRef[];
  metric?: Record<string, number | string | boolean | undefined>;
  probe?: Record<string, unknown>;
  events?: string[];
}

export interface Signal {
  id: string;
  severity: Severity;
  titleFa: string;
  evidence: SignalEvidence;
  /** Extracted detail, e.g. the missing env name or module. */
  detail?: string;
}

export type Detector = (snapshot: Snapshot) => Signal[];
