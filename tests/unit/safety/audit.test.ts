import { appendFileSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { guard, ScriptedApprover } from '../../../src/safety/approval.js';
import { AuditLog, readAudit } from '../../../src/safety/audit.js';
import { Risk, type ActionPlan } from '../../../src/safety/risk.js';
import { Secret } from '../../../src/shared/secret.js';

const plan = (over: Partial<ActionPlan> = {}): ActionPlan => ({
  id: 'p',
  toolName: 'set_env',
  titleFa: 'تنظیم env',
  reasonFa: 'r',
  target: { app: 'shop' },
  risk: Risk.R2,
  impactFa: 'i',
  rollbackFa: 'b',
  command: 'POST /v1/projects/update-envs',
  params: { vars: { DATABASE_URL: 'postgres://u:dbpass777@h/db' }, token: 'tok-should-hide' },
  ...over,
});

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'siavash-audit-'));
  let t = Date.parse('2026-10-20T10:00:00.000Z');
  const log = new AuditLog(dir, () => new Date((t += 60_000)));
  return { dir, log };
}

describe('AuditLog', () => {
  it('every guard call writes exactly one record — approved, denied, dry-run, error', async () => {
    const { log } = setup();
    await guard(plan(), new ScriptedApprover(['approved']), async () => 1, { audit: log, sessionId: 's1', actor: 'user' });
    await guard(plan(), new ScriptedApprover(['denied']), async () => 1, { audit: log }).catch(() => undefined);
    await guard(plan(), new ScriptedApprover(['approved']), async () => 1, { audit: log, dryRun: true });
    await guard(plan(), new ScriptedApprover(['approved']), async () => {
      throw new Error('x');
    }, { audit: log }).catch(() => undefined);
    const all = log.read();
    expect(all.map((e) => e.result)).toEqual(['ok', 'denied', 'dry-run', 'error']);
    expect(all[0]).toMatchObject({ sessionId: 's1', actor: 'user', tool: 'set_env', risk: 'R2', target: { app: 'shop' } });
    expect(all[1]?.errorCode).toBe('APPROVAL_DENIED');
  });

  it('params are redacted in the log file', async () => {
    const { log } = setup();
    await guard(plan(), new ScriptedApprover(['approved']), async () => 1, { audit: log });
    const raw = readFileSync(log.path, 'utf8');
    expect(raw).not.toContain('dbpass777');
    expect(raw).not.toContain('tok-should-hide');
  });

  it('undo: masked params in the log, real previous secrets in a separate file', async () => {
    const { log } = setup();
    const p = plan({
      undo: {
        tool: 'set_env',
        params: { keys: ['DATABASE_URL'] },
        secretValues: { DATABASE_URL: new Secret('postgres://old:oldpass555@h/db') },
      },
    });
    await guard(p, new ScriptedApprover(['approved']), async () => 1, { audit: log });
    const raw = readFileSync(log.path, 'utf8');
    expect(raw).not.toContain('oldpass555');
    const [entry] = log.read();
    expect(entry?.undo?.tool).toBe('set_env');
    expect(entry?.undo?.secretRef).toBeDefined();
    expect(log.readUndoSecrets(entry!)).toEqual({ DATABASE_URL: 'postgres://old:oldpass555@h/db' });
    if (process.platform !== 'win32') {
      expect(statSync(entry!.undo!.secretRef!).mode & 0o777).toBe(0o600);
    }
  });

  it('undo without secrets has no secretRef', async () => {
    const { log } = setup();
    await guard(
      plan({ toolName: 'resize_app', params: { planID: 'p2' }, undo: { tool: 'resize_app', params: { planID: 'p1' } } }),
      new ScriptedApprover(['approved']),
      async () => 1,
      { audit: log },
    );
    expect(log.read()[0]?.undo).toEqual({ tool: 'resize_app', params: { planID: 'p1' } });
  });

  it('readAudit filters by since, app and tool; skips corrupt lines', async () => {
    const { dir, log } = setup();
    const ex = async () => 1;
    await guard(plan({ toolName: 'restart_app', risk: Risk.R1 }), new ScriptedApprover(['approved']), ex, { audit: log });
    await guard(plan({ target: { app: 'other' } }), new ScriptedApprover(['approved']), ex, { audit: log });
    appendFileSync(join(dir, 'audit.jsonl'), 'garbage\n');
    await guard(plan(), new ScriptedApprover(['approved']), ex, { audit: log });
    expect(readAudit(dir)).toHaveLength(3);
    expect(readAudit(dir, { app: 'other' })).toHaveLength(1);
    expect(readAudit(dir, { tool: 'restart_app' })).toHaveLength(1);
    expect(readAudit(dir, { since: '2026-10-20T10:02:30.000Z' })).toHaveLength(1);
  });

  it('missing file → empty', () => {
    expect(readAudit(mkdtempSync(join(tmpdir(), 'siavash-empty-')))).toEqual([]);
  });
});
