import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { logger } from '../shared/logger.js';

/**
 * Local deployment ledger — replaces the release list/status/rollback that the Liara API lacks (G4).
 * Storage: append-only JSONL. An `update` appends a new full snapshot of the record; the last line per id wins.
 */

export const DeploymentResultSchema = z.enum(['pending', 'success', 'failed', 'timeout', 'rolled-back']);
export type DeploymentResult = z.infer<typeof DeploymentResultSchema>;

export const DeploymentRecordSchema = z.object({
  id: z.string(),
  app: z.string(),
  mode: z.enum(['api', 'cli']),
  releaseID: z.string().optional(),
  sourceID: z.string().optional(),
  /** Version label from CLI output, e.g. "v12". */
  version: z.string().optional(),
  gitCommit: z.string().optional(),
  gitDirty: z.boolean().default(false),
  archiveSha256: z.string().optional(),
  port: z.number().optional(),
  platform: z.string().optional(),
  message: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  result: DeploymentResultSchema,
  healthAfter: z.object({ score: z.number(), verdict: z.string() }).optional(),
  /** If this deployment is a rollback, the id of the deployment it restored. */
  rollbackOf: z.string().optional(),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;

export type NewDeployment = Omit<DeploymentRecord, 'id' | 'startedAt' | 'result' | 'gitDirty'> &
  Partial<Pick<DeploymentRecord, 'id' | 'startedAt' | 'result' | 'gitDirty'>>;

export interface LedgerOptions {
  /** `${DATA_DIR}` — records go to `${dataDir}/ledger/<app>.jsonl`. */
  dataDir: string;
  /** Project dir; a copy goes to `<projectDir>/.siavash/deployments.jsonl`. */
  projectDir?: string;
  now?: () => Date;
  onCorruptLine?: (info: { file: string; line: number; reason: string }) => void;
}

function safeAppName(app: string): string {
  return app.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export class DeploymentLedger {
  private readonly now: () => Date;

  constructor(private readonly opts: LedgerOptions) {
    this.now = opts.now ?? (() => new Date());
  }

  fileFor(app: string): string {
    return join(this.opts.dataDir, 'ledger', `${safeAppName(app)}.jsonl`);
  }

  private projectFile(): string | undefined {
    return this.opts.projectDir ? join(this.opts.projectDir, '.siavash', 'deployments.jsonl') : undefined;
  }

  private append(rec: DeploymentRecord): void {
    const line = `${JSON.stringify(rec)}\n`;
    for (const f of [this.fileFor(rec.app), this.projectFile()]) {
      if (!f) continue;
      mkdirSync(dirname(f), { recursive: true });
      appendFileSync(f, line, 'utf8');
    }
  }

  /** Creates a record (result defaults to 'pending'). */
  record(input: NewDeployment): DeploymentRecord {
    const rec = DeploymentRecordSchema.parse({
      ...input,
      id: input.id ?? randomUUID(),
      startedAt: input.startedAt ?? this.now().toISOString(),
      result: input.result ?? 'pending',
      gitDirty: input.gitDirty ?? false,
    });
    this.append(rec);
    return rec;
  }

  /** Appends an updated snapshot. Throws if the id is unknown for that app. */
  update(app: string, id: string, patch: Partial<Omit<DeploymentRecord, 'id' | 'app'>>): DeploymentRecord {
    const current = this.list(app).find((r) => r.id === id);
    if (!current) throw new Error(`ledger: unknown deployment ${id} for ${app}`);
    const next = DeploymentRecordSchema.parse({ ...current, ...patch, id, app });
    if (!next.finishedAt && patch.result && patch.result !== 'pending') next.finishedAt = this.now().toISOString();
    this.append(next);
    return next;
  }

  /** All deployments of an app, oldest first (latest snapshot per id). Corrupt lines are skipped and reported. */
  list(app: string): DeploymentRecord[] {
    const file = this.fileFor(app);
    if (!existsSync(file)) return [];
    const byId = new Map<string, DeploymentRecord>();
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.trim() === '') return;
      let reason: string | undefined;
      try {
        const parsed = DeploymentRecordSchema.safeParse(JSON.parse(line));
        if (parsed.success) {
          byId.set(parsed.data.id, parsed.data);
          return;
        }
        reason = parsed.error.issues[0]?.message ?? 'schema';
      } catch (e) {
        reason = e instanceof Error ? e.message : 'invalid json';
      }
      const info = { file, line: i + 1, reason: reason ?? 'invalid' };
      this.opts.onCorruptLine?.(info);
      logger.warn(info, 'ledger: skipped corrupt line');
    });
    return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  latest(app: string): DeploymentRecord | undefined {
    const all = this.list(app);
    return all[all.length - 1];
  }

  /**
   * Most recent successful deployment before `beforeId` (default: before the latest one) — the rollback target.
   * Health verdicts (T7.6) can refine this later; for now `result === 'success'` is the criterion.
   */
  previousHealthy(app: string, beforeId?: string): DeploymentRecord | undefined {
    const all = this.list(app);
    const end = beforeId ? all.findIndex((r) => r.id === beforeId) : all.length - 1;
    const upto = end < 0 ? all : all.slice(0, end);
    return [...upto].reverse().find((r) => r.result === 'success');
  }

  findByCommit(app: string, commit: string): DeploymentRecord[] {
    return this.list(app).filter((r) => r.gitCommit !== undefined && (r.gitCommit === commit || r.gitCommit.startsWith(commit)));
  }
}
