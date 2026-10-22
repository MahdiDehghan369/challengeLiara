import { randomUUID } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { logger } from '../shared/logger.js';
import type { AuditSink, GuardAuditRecord } from './approval.js';
import { redactObject } from './redact.js';
import { riskLabel } from './risk.js';

export const AuditEntrySchema = z.object({
  id: z.string(),
  ts: z.string(),
  sessionId: z.string(),
  actor: z.enum(['user', 'agent', 'runbook']),
  tool: z.string(),
  risk: z.enum(['R0', 'R1', 'R2', 'R3']),
  target: z.object({ app: z.string().optional(), resource: z.string().optional() }),
  decision: z.string(),
  paramsRedacted: z.record(z.string(), z.unknown()),
  result: z.enum(['ok', 'error', 'dry-run', 'denied', 'pending']),
  errorCode: z.string().optional(),
  durationMs: z.number(),
  undo: z
    .object({
      tool: z.string(),
      params: z.record(z.string(), z.unknown()),
      /** File holding previous secret values (mode 600), if any. */
      secretRef: z.string().optional(),
    })
    .optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export interface ReadAuditFilter {
  /** ISO timestamp or Date; entries at/after it. */
  since?: string | Date;
  app?: string;
  tool?: string;
}

/** Append-only JSONL audit log at `${dataDir}/audit.jsonl`; implements the gate's AuditSink. */
export class AuditLog implements AuditSink {
  private readonly file: string;
  private readonly undoDir: string;

  constructor(
    private readonly dataDir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(dataDir, 'audit.jsonl');
    this.undoDir = join(dataDir, 'undo');
  }

  get path(): string {
    return this.file;
  }

  record(rec: GuardAuditRecord): AuditEntry {
    const id = randomUUID();
    const { plan } = rec;
    let undo: AuditEntry['undo'];
    if (plan.undo) {
      let secretRef: string | undefined;
      const secrets = plan.undo.secretValues;
      if (secrets && Object.keys(secrets).length > 0) {
        mkdirSync(this.undoDir, { recursive: true });
        secretRef = join(this.undoDir, `${id}.json`);
        const plain = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, v.reveal()]));
        writeFileSync(secretRef, JSON.stringify(plain), { encoding: 'utf8', mode: 0o600 });
        try {
          chmodSync(secretRef, 0o600);
        } catch {
          // best effort on platforms without POSIX modes
        }
      }
      undo = {
        tool: plan.undo.tool,
        params: redactObject(plan.undo.params),
        ...(secretRef ? { secretRef } : {}),
      };
    }
    const entry: AuditEntry = {
      id,
      ts: this.now().toISOString(),
      sessionId: rec.sessionId,
      actor: rec.actor,
      tool: plan.toolName,
      risk: riskLabel(plan.risk),
      target: plan.target,
      decision: rec.decision,
      paramsRedacted: redactObject(plan.params),
      result: rec.result,
      ...(rec.errorCode ? { errorCode: rec.errorCode } : {}),
      durationMs: rec.durationMs,
      ...(undo ? { undo } : {}),
    };
    mkdirSync(this.dataDir, { recursive: true });
    appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    return entry;
  }

  read(filter: ReadAuditFilter = {}): AuditEntry[] {
    if (!existsSync(this.file)) return [];
    const since = filter.since === undefined ? undefined : new Date(filter.since).getTime();
    const out: AuditEntry[] = [];
    readFileSync(this.file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (!line.trim()) return;
        try {
          const e = AuditEntrySchema.parse(JSON.parse(line));
          if (since !== undefined && Date.parse(e.ts) < since) return;
          if (filter.app && e.target.app !== filter.app) return;
          if (filter.tool && e.tool !== filter.tool) return;
          out.push(e);
        } catch {
          logger.warn({ file: this.file, line: i + 1 }, 'audit: skipped corrupt line');
        }
      });
    return out;
  }

  /** Reads the previous secret values saved for an entry's undo (for `history`/undo, T10.6). */
  readUndoSecrets(entry: AuditEntry): Record<string, string> | undefined {
    const ref = entry.undo?.secretRef;
    if (!ref || !existsSync(ref)) return undefined;
    return JSON.parse(readFileSync(ref, 'utf8')) as Record<string, string>;
  }
}

export function readAudit(dataDir: string, filter: ReadAuditFilter = {}): AuditEntry[] {
  return new AuditLog(dataDir).read(filter);
}
