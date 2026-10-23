import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { createSourceArchive, type AppEvent, type CreateReleaseInput, type EventsQuery, type ReleaseOutcome, type ReleaseSignal, type UploadProgress, type WaitForReleaseOptions } from '../../liara/index.js';
import type { DeployProgress, StrategyResult } from './cli.js';

/**
 * API deploy strategy (T5.7): archive → upload (with percent) → createRelease → waitForRelease.
 * TODO(OQ-15): Liara's build-finished signal for this path is unknown (G5); the default signals read
 * deploy events after the release was created and are interim. A timeout is reported as such, never
 * as success.
 */

export interface ApiDeployer {
  uploadSource(name: string, archivePath: string, onProgress?: UploadProgress): Promise<string>;
  createRelease(name: string, input: CreateReleaseInput): Promise<string>;
  waitForRelease(name: string, releaseID: string, opts: WaitForReleaseOptions): Promise<ReleaseOutcome>;
}

export interface EventsReader {
  getEvents(name: string, q?: EventsQuery): Promise<AppEvent[]>;
}

export interface LogsReader {
  getLogs(name: string, opts?: { windowSec?: number }): Promise<Array<{ text: string }>>;
}

const FAILED_RE = /\b(fail(ed|ure)?|error)\b/i;
const SUCCESS_RE = /\b(deployed|succeeded|successful(ly)?)\b/i;

/** Interim signal: deploy-kind events newer than `sinceMs` (TODO(OQ-15)). */
export function deployEventsSignal(events: EventsReader, sinceMs: number): ReleaseSignal {
  return {
    name: 'events',
    check: async ({ app }) => {
      // event timestamps may have second resolution: compare at that granularity
      const sinceSec = Math.floor(sinceMs / 1000);
      const recent = (await events.getEvents(app, { start: sinceSec })).filter(
        (e) => e.kind === 'deploy' && (e.ts === undefined || e.ts >= sinceSec * 1000),
      );
      const failed = recent.find((e) => FAILED_RE.test(e.message));
      if (failed) return { verdict: 'failed', evidence: failed.message };
      const ok = recent.find((e) => SUCCESS_RE.test(e.message));
      if (ok) return { verdict: 'success', evidence: ok.message };
      return { verdict: 'pending' };
    },
  };
}

export interface ApiDeployInput {
  projectPath: string;
  app: string;
  port: number;
  platform: string;
  signals: ReleaseSignal[];
  wait?: Pick<WaitForReleaseOptions, 'timeoutMs' | 'intervalMs' | 'sleep' | 'now'>;
}

export async function deployViaApi(
  api: ApiDeployer,
  input: ApiDeployInput,
  progress: DeployProgress & { archiving?(): void; waiting?(): void } = {},
  logs?: LogsReader,
): Promise<StrategyResult> {
  progress.archiving?.();
  const archive = await createSourceArchive(input.projectPath);
  try {
    progress.stage?.('upload');
    const sourceID = await api.uploadSource(input.app, archive.path, (p) => progress.percent?.(p));
    progress.stage?.('release');
    const releaseID = await api.createRelease(input.app, { sourceID, port: input.port, type: input.platform });
    progress.waiting?.();
    const outcome = await api.waitForRelease(input.app, releaseID, { signals: input.signals, ...input.wait });
    const tail =
      outcome.result === 'success' || !logs
        ? []
        : (await logs.getLogs(input.app, { windowSec: 900 }).catch(() => [])).map((l) => l.text).slice(-30);
    return { result: outcome.result, sourceID, releaseID, archiveSha256: archive.sha256, tail, evidence: outcome.evidence };
  } finally {
    rmSync(dirname(archive.path), { recursive: true, force: true });
  }
}
