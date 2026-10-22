import { randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { z } from 'zod';
import type { LiaraHttp, RawBody } from '../http.js';

export const SourceResponseSchema = z.object({ sourceID: z.string().min(1) }).passthrough();
export const ReleaseResponseSchema = z.object({ releaseID: z.string().min(1) }).passthrough();

export interface CreateReleaseInput {
  sourceID: string;
  port: number;
  /** Liara platform, e.g. "node". */
  type: string;
}

export type UploadProgress = (percent: number, sentBytes: number, totalBytes: number) => void;

/**
 * Streams `multipart/form-data` with a single `file` part straight from disk and reports progress as
 * fetch pulls bytes (FormData exposes no progress hook).
 */
export function multipartFileBody(filePath: string, field: string, onProgress?: UploadProgress): RawBody {
  const boundary = `----siavash${randomBytes(12).toString('hex')}`;
  const fileName = basename(filePath).replace(/"/g, '');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\n` +
      'Content-Type: application/gzip\r\n\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fileSize = statSync(filePath).size;
  let sent = 0;
  let lastPct = -1;
  const report = () => {
    const pct = fileSize === 0 ? 100 : Math.floor((sent / fileSize) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      onProgress?.(pct, sent, fileSize);
    }
  };

  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield head;
    for await (const c of createReadStream(filePath, { highWaterMark: 256 * 1024 })) {
      const buf = c as Buffer;
      sent += buf.length;
      report();
      yield buf;
    }
    if (fileSize === 0) report();
    yield tail;
  }

  const it = chunks();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: head.length + fileSize + tail.length,
  };
}

export type ReleaseVerdict = 'success' | 'failed' | 'pending';

/** One observation about a release, e.g. from events, logs, the app list or an HTTP probe. */
export interface ReleaseSignal {
  name: string;
  check: (ctx: { app: string; releaseID: string }) => Promise<{ verdict: ReleaseVerdict; evidence?: string }>;
}

export interface WaitForReleaseOptions {
  /**
   * TODO(OQ-15): the build-finished/failed signal of the API deploy path is unknown (G5, BEHAVIOR §3).
   * Callers compose signals (events, logs, app status, probe); any 'failed' wins, then any 'success'.
   */
  signals: ReleaseSignal[];
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onTick?: (elapsedMs: number, observations: string[]) => void;
}

export interface ReleaseOutcome {
  result: 'success' | 'failed' | 'timeout';
  evidence: string[];
  elapsedMs: number;
}

export class DeployApi {
  constructor(private readonly http: LiaraHttp) {}

  /** `POST /v2/projects/{name}/sources` (multipart field `file`, a .tar.gz) → sourceID. */
  async uploadSource(name: string, archivePath: string, onProgress?: UploadProgress): Promise<string> {
    const res = await this.http.post(`/v2/projects/${encodeURIComponent(name)}/sources`, {
      rawBody: multipartFileBody(archivePath, 'file', onProgress),
      schema: SourceResponseSchema,
      operationId: 'deploy.uploadSource',
    });
    return res.sourceID;
  }

  /** `POST /v2/projects/{name}/releases` `{sourceID, port, type}` → releaseID. */
  async createRelease(name: string, input: CreateReleaseInput): Promise<string> {
    const res = await this.http.post(`/v2/projects/${encodeURIComponent(name)}/releases`, {
      body: { sourceID: input.sourceID, port: input.port, type: input.type },
      schema: ReleaseResponseSchema,
      operationId: 'deploy.createRelease',
    });
    return res.releaseID;
  }

  /** Polls the given signals until one decides the release, or times out. Never re-deploys. */
  async waitForRelease(name: string, releaseID: string, opts: WaitForReleaseOptions): Promise<ReleaseOutcome> {
    const timeoutMs = opts.timeoutMs ?? 15 * 60_000;
    const intervalMs = opts.intervalMs ?? 5_000;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = opts.now ?? Date.now;
    const start = now();
    const evidence: string[] = [];
    for (;;) {
      const observations: string[] = [];
      let failed = false;
      let succeeded = false;
      for (const s of opts.signals) {
        try {
          const r = await s.check({ app: name, releaseID });
          if (r.evidence) observations.push(`${s.name}: ${r.evidence}`);
          if (r.verdict === 'failed') failed = true;
          if (r.verdict === 'success') succeeded = true;
        } catch (e) {
          observations.push(`${s.name}: error ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      for (const o of observations) if (!evidence.includes(o)) evidence.push(o);
      const elapsedMs = now() - start;
      opts.onTick?.(elapsedMs, observations);
      if (failed) return { result: 'failed', evidence, elapsedMs };
      if (succeeded) return { result: 'success', evidence, elapsedMs };
      if (elapsedMs + intervalMs > timeoutMs) return { result: 'timeout', evidence, elapsedMs };
      await sleep(intervalMs);
    }
  }
}
