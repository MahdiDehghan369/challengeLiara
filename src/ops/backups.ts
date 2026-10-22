import type { Backup, Disk, FtpCredentials, MetricsSummary } from '../liara/index.js';
import type { Accepted } from '../liara/http.js';
import { guard, type GuardResult } from '../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../safety/risk.js';
import type { Secret } from '../shared/secret.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { guardOptions, newPlanId, type OpsContext } from './context.js';

/** The disks backend (implemented by `DisksApi`, T1.11). */
export interface DisksBackend {
  listDisks(app: string): Promise<{ disks: Disk[]; mounts: Array<{ name: string; mountedTo: string }> }>;
  createDisk(app: string, disk: { name: string; size: number | string }): Promise<Accepted>;
  resizeDisk(app: string, disk: string, size: number | string): Promise<Accepted>;
  listBackups(app: string, disk: string): Promise<Backup[]>;
  createBackup(app: string, disk: string): Promise<Accepted>;
  getBackupDownloadLink(app: string, disk: string, backup: string): Promise<Secret<string>>;
  createFtp(app: string, disk: string, input: { username: string; readOnly: boolean }): Promise<FtpCredentials>;
}

export interface MetricsSummaryBackend {
  getSummary(app: string): Promise<MetricsSummary>;
}

export const DISK_USAGE_WARN_PERCENT = 80;

export interface DiskWithUsage extends Disk {
  /** usage / size from the metrics summary (TODO(OQ-25): assumes both use the same unit). */
  usagePercent: number | undefined;
  warningFa: string | undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** `list_disks` (R0): disks + mount points + usage percent from the summary; warns above 80%. */
export async function listDisksWithUsage(
  disks: DisksBackend,
  metrics: MetricsSummaryBackend | undefined,
  app: string,
): Promise<{ disks: DiskWithUsage[]; warningsFa: string[] }> {
  const [{ disks: list }, summary] = await Promise.all([
    disks.listDisks(app),
    metrics ? metrics.getSummary(app).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const usage = new Map((summary?.disks ?? []).map((d) => [d.name, d]));
  const out = list.map((d) => {
    const u = usage.get(d.name);
    const size = num(u?.sizeRaw);
    const used = num(u?.usageRaw);
    const usagePercent = size && size > 0 && used !== undefined ? Math.round((used / size) * 1000) / 10 : undefined;
    const warningFa =
      usagePercent !== undefined && usagePercent > DISK_USAGE_WARN_PERCENT
        ? fa.opsDisks.usageHigh(d.name, Math.round(usagePercent))
        : undefined;
    return { ...d, usagePercent, warningFa };
  });
  return { disks: out, warningsFa: out.flatMap((d) => (d.warningFa ? [d.warningFa] : [])) };
}

/** `list_backups` (R0). */
export function listBackups(disks: DisksBackend, app: string, disk: string): Promise<Backup[]> {
  return disks.listBackups(app, disk);
}

/** Adds the "take a backup first" line to R2/R3 plans that touch an existing disk. */
export function withBackupSuggestion(plan: ActionPlan, disk: string): ActionPlan {
  if (plan.risk < Risk.R2) return plan;
  return { ...plan, impactFa: `${plan.impactFa}\n${fa.opsDisks.suggestBackup(disk)}` };
}

const reason = (r?: string) => r ?? fa.opsDisks.defaultReason;

/** `create_backup` (R1). */
export function createBackup(
  disks: DisksBackend,
  app: string,
  disk: string,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Accepted>> {
  const plan = escalate(
    {
      id: newPlanId('create-backup'),
      toolName: 'create_backup',
      titleFa: fa.opsDisks.createBackupTitle(disk),
      reasonFa: reason(opts.reasonFa),
      target: { app, resource: `disk:${disk}` },
      risk: Risk.R1,
      impactFa: fa.opsDisks.createBackupImpact,
      rollbackFa: fa.opsDisks.createBackupRollback,
      command: `POST /v1/projects/{id}/disks/${disk}/backups`,
      params: { app, disk },
    },
    ctx.risk ?? {},
  );
  return guard(plan, ctx.approver, () => disks.createBackup(app, disk), guardOptions(ctx));
}

/**
 * `backup_download_link` (R1). The signed link stays a `Secret`: it is for the UI only and must never
 * be passed to the LLM (JSON serialisation shows a placeholder).
 */
export function backupDownloadLink(
  disks: DisksBackend,
  app: string,
  disk: string,
  backup: string,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Secret<string>>> {
  const plan = escalate(
    {
      id: newPlanId('backup-link'),
      toolName: 'backup_download_link',
      titleFa: fa.opsDisks.downloadTitle(backup),
      reasonFa: reason(opts.reasonFa),
      target: { app, resource: `disk:${disk}` },
      risk: Risk.R1,
      impactFa: fa.opsDisks.downloadImpact,
      rollbackFa: fa.opsDisks.downloadRollback,
      command: `POST /v1/projects/{id}/disks/${disk}/backups/${backup}/download`,
      params: { app, disk, backup },
    },
    ctx.risk ?? {},
  );
  return guard(plan, ctx.approver, () => disks.getBackupDownloadLink(app, disk, backup), guardOptions(ctx));
}

/** `resize_disk` (R2) with a backup suggestion. */
export function resizeDisk(
  disks: DisksBackend,
  app: string,
  disk: string,
  sizeGb: number,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Accepted>> {
  const plan = withBackupSuggestion(
    escalate(
      {
        id: newPlanId('resize-disk'),
        toolName: 'resize_disk',
        titleFa: fa.opsDisks.resizeTitle(disk, String(sizeGb)),
        reasonFa: reason(opts.reasonFa),
        target: { app, resource: `disk:${disk}` },
        risk: Risk.R2,
        impactFa: fa.opsDisks.resizeImpact,
        rollbackFa: fa.opsDisks.resizeRollback,
        command: `POST /v1/projects/${app}/disks/${disk}/resize  {size: "${sizeGb}"}`,
        params: { app, disk, size: sizeGb },
      },
      ctx.risk ?? {},
    ),
    disk,
  );
  return guard(plan, ctx.approver, (p) => disks.resizeDisk(app, disk, Number(p.size ?? sizeGb)), guardOptions(ctx));
}

/** `create_disk` (R2: monthly cost). A new disk holds no data, so no backup suggestion. */
export function createDisk(
  disks: DisksBackend,
  app: string,
  input: { name: string; sizeGb: number },
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Accepted>> {
  const plan = escalate(
    {
      id: newPlanId('create-disk'),
      toolName: 'create_disk',
      titleFa: fa.opsDisks.createDiskTitle(input.name, String(input.sizeGb)),
      reasonFa: reason(opts.reasonFa),
      target: { app, resource: `disk:${input.name}` },
      risk: Risk.R2,
      impactFa: fa.opsDisks.createDiskImpact,
      rollbackFa: fa.opsDisks.createDiskRollback,
      command: `POST /v1/projects/${app}/disks  {name: "${input.name}", size: "${input.sizeGb}"}`,
      params: { app, name: input.name, size: input.sizeGb },
    },
    ctx.risk ?? {},
  );
  return guard(
    plan,
    ctx.approver,
    (p) => disks.createDisk(app, { name: String(p.name ?? input.name), size: Number(p.size ?? input.sizeGb) }),
    guardOptions(ctx),
  );
}

/** `create_ftp` (R2). The password is a `Secret`, shown once by the UI and never sent to the LLM. */
export function createFtp(
  disks: DisksBackend,
  app: string,
  disk: string,
  input: { username: string; readOnly: boolean },
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<FtpCredentials>> {
  const plan = withBackupSuggestion(
    escalate(
      {
        id: newPlanId('create-ftp'),
        toolName: 'create_ftp',
        titleFa: fa.opsDisks.createFtpTitle(disk, input.username),
        reasonFa: reason(opts.reasonFa),
        target: { app, resource: `disk:${disk}` },
        risk: Risk.R2,
        impactFa: fa.opsDisks.createFtpImpact(input.readOnly),
        rollbackFa: fa.opsDisks.createFtpRollback,
        command: `POST /v1/projects/${app}/disks/${disk}/ftp  {username: "${input.username}", readOnly: ${input.readOnly}}`,
        params: { app, disk, username: input.username, readOnly: input.readOnly },
      },
      ctx.risk ?? {},
    ),
    disk,
  );
  return guard(
    plan,
    ctx.approver,
    (p) => disks.createFtp(app, disk, { username: String(p.username ?? input.username), readOnly: p.readOnly !== false }),
    guardOptions(ctx),
  );
}
