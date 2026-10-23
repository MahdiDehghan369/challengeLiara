import type { Snapshot } from '../snapshot.js';
import { appDown, crashLoop, http5xxRate, portMismatch, slowResponse, tlsIssue } from './availability.js';
import { releaseRegression, unhandledException } from './code.js';
import { dbConnection, missingEnv, moduleNotFound } from './config.js';
import { cpuSaturation, diskFull, memoryLeakTrend, oom, readOnlyFs } from './resources.js';
import type { Detector, Signal } from './types.js';

export * from './types.js';
export * from './availability.js';
export * from './resources.js';
export * from './config.js';
export * from './code.js';

/** All detectors (T7.5), in report order. */
export const DETECTORS: Record<string, Detector> = {
  'app-down': appDown,
  'crash-loop': crashLoop,
  oom,
  'memory-leak-trend': memoryLeakTrend,
  'cpu-saturation': cpuSaturation,
  'http-5xx-rate': http5xxRate,
  'slow-response': slowResponse,
  'missing-env': missingEnv,
  'port-mismatch': portMismatch,
  'db-connection': dbConnection,
  'module-not-found': moduleNotFound,
  'unhandled-exception': unhandledException,
  'disk-full': diskFull,
  'release-regression': releaseRegression,
  'tls-issue': tlsIssue,
  'read-only-fs': readOnlyFs,
};

const RANK = { critical: 0, warn: 1, info: 2 } as const;

/** Runs every detector; a detector that throws is skipped (it must never break the report). Critical first. */
export function runDetectors(snapshot: Snapshot, detectors: Record<string, Detector> = DETECTORS): Signal[] {
  const out: Signal[] = [];
  for (const d of Object.values(detectors)) {
    try {
      out.push(...d(snapshot));
    } catch {
      // a buggy detector must not hide the others
    }
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
