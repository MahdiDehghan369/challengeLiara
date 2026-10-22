import type { Domain, FtpAccess } from '../liara/index.js';
import type { RunResult } from '../liara/cli.js';
import type { Accepted } from '../liara/http.js';
import { guard, type GuardResult } from '../safety/approval.js';
import { escalate, Risk, type ActionPlan } from '../safety/risk.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { guardOptions, newPlanId, type OpsContext } from './context.js';

/**
 * Safe deletion (T6.8). Every delete is R3: the card lists all dependent resources, suggests a backup,
 * and the approver requires typing the name (app name, or the resource name when there is no app).
 */

export interface AppDeleteBackend {
  deleteApp(name: string): Promise<Accepted>;
  /** Confirms the async delete (normally `waitAppGone(apps, name)`). */
  waitGone(name: string): Promise<void>;
}

export interface DiskDeleteBackend {
  listDisks(app: string): Promise<{ disks: Array<{ name: string }>; mounts: Array<{ name: string; mountedTo: string }> }>;
  listFtp?(app: string, disk: string): Promise<{ accesses: FtpAccess[] }>;
  deleteDisk(app: string, disk: string): Promise<Accepted>;
  deleteFtp(ftpName: string): Promise<Accepted>;
}

export interface DomainDeleteBackend {
  listDomains(app: string): Promise<Domain[]>;
  deleteDomain(id: string): Promise<Accepted>;
}

export interface DbDeleteBackend {
  dbRemove(name: string): Promise<RunResult>;
}

const d = fa.opsDelete;

function impact(lines: string[], extra: string[]): string {
  return [
    d.irreversible,
    ...(lines.length ? [d.dependents, ...lines.map((l) => `- ${l}`)] : [d.noDependents]),
    ...extra,
  ].join('\n');
}

function r3(plan: Omit<ActionPlan, 'id' | 'risk' | 'rollbackFa'>, ctx: OpsContext): ActionPlan {
  return escalate({ ...plan, id: newPlanId(plan.toolName), risk: Risk.R3, rollbackFa: d.noRollback }, ctx.risk ?? {});
}

async function ftpLines(disks: DiskDeleteBackend, app: string, disk: string): Promise<string[]> {
  if (!disks.listFtp) return [];
  const { accesses } = await disks.listFtp(app, disk).catch(() => ({ accesses: [] as FtpAccess[] }));
  return accesses.map((a) => d.ftpLine(a.username, disk));
}

/** Everything that goes away with an app: disks (+ mounts, FTP) and domains. */
export async function appDependents(
  app: string,
  b: { disks?: DiskDeleteBackend; domains?: DomainDeleteBackend },
): Promise<{ lines: string[]; disks: string[] }> {
  const lines: string[] = [];
  const diskNames: string[] = [];
  if (b.disks) {
    const { disks, mounts } = await b.disks.listDisks(app);
    const mountOf = new Map(mounts.map((m) => [m.name, m.mountedTo]));
    for (const disk of disks) {
      diskNames.push(disk.name);
      lines.push(d.diskLine(disk.name, mountOf.get(disk.name)));
      lines.push(...(await ftpLines(b.disks, app, disk.name)));
    }
  }
  if (b.domains) lines.push(...(await b.domains.listDomains(app)).map((x) => d.domainLine(x.name)));
  return { lines, disks: diskNames };
}

/** `delete_app` (R3) → confirmed with `waitGone` after the delete is accepted. */
export async function deleteApp(
  b: { apps: AppDeleteBackend; disks?: DiskDeleteBackend; domains?: DomainDeleteBackend },
  app: string,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<{ deleted: true }>> {
  const deps = await appDependents(app, b);
  const plan = r3(
    {
      toolName: 'delete_app',
      titleFa: d.titleApp(app),
      reasonFa: opts.reasonFa ?? d.defaultReason,
      target: { app },
      impactFa: impact(deps.lines, [
        deps.disks.length ? d.suggestDiskBackups(deps.disks.join(', ')) : d.suggestBackup,
        d.dbNotDeleted,
      ]),
      command: `DELETE /v1/projects/${app}`,
      params: { app },
    },
    ctx,
  );
  return guard(
    plan,
    ctx.approver,
    async () => {
      await b.apps.deleteApp(app);
      await b.apps.waitGone(app);
      return { deleted: true as const };
    },
    guardOptions(ctx),
  );
}

/** `delete_disk` (R3): lists its mount point and FTP accesses; suggests a backup. */
export async function deleteDisk(
  disks: DiskDeleteBackend,
  app: string,
  disk: string,
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Accepted>> {
  const { mounts } = await disks.listDisks(app);
  const mount = mounts.find((m) => m.name === disk)?.mountedTo;
  const lines = [...(mount ? [d.diskLine(disk, mount)] : []), ...(await ftpLines(disks, app, disk))];
  const plan = r3(
    {
      toolName: 'delete_disk',
      titleFa: d.titleDisk(disk, app),
      reasonFa: opts.reasonFa ?? d.defaultReason,
      target: { app, resource: `disk:${disk}` },
      impactFa: impact(lines, [d.suggestDiskBackups(disk)]),
      command: `DELETE /v1/projects/{id}/disks/${disk}`,
      params: { app, disk },
    },
    ctx,
  );
  return guard(plan, ctx.approver, () => disks.deleteDisk(app, disk), guardOptions(ctx));
}

/** `delete_domain` (R3). With `app`, the user types the app name; otherwise the domain name. */
export function deleteDomain(
  domains: DomainDeleteBackend,
  domain: { id: string; name: string; app?: string },
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Accepted>> {
  const plan = r3(
    {
      toolName: 'delete_domain',
      titleFa: d.titleDomain(domain.name),
      reasonFa: opts.reasonFa ?? d.defaultReason,
      target: domain.app ? { app: domain.app, resource: domain.name } : { resource: domain.name },
      impactFa: impact([d.domainLine(domain.name)], [d.domainImpact]),
      command: `DELETE /v1/domains/${domain.id}`,
      params: { id: domain.id, name: domain.name },
    },
    ctx,
  );
  return guard(plan, ctx.approver, () => domains.deleteDomain(domain.id), guardOptions(ctx));
}

/** `delete_database` (R3): the user types the database name. */
export function deleteDatabase(
  db: DbDeleteBackend,
  name: string,
  ctx: OpsContext,
  opts: { reasonFa?: string; usedBy?: string[] } = {},
): Promise<GuardResult<RunResult>> {
  const plan = r3(
    {
      toolName: 'delete_database',
      titleFa: d.titleDb(name),
      reasonFa: opts.reasonFa ?? d.defaultReason,
      target: { resource: name },
      impactFa: impact(opts.usedBy ?? [], [d.dbImpact, d.suggestBackup]),
      command: `liara db remove -n ${name} -y`,
      params: { name },
    },
    ctx,
  );
  return guard(plan, ctx.approver, () => db.dbRemove(name), guardOptions(ctx));
}

/** `delete_ftp` (R3). */
export function deleteFtp(
  disks: Pick<DiskDeleteBackend, 'deleteFtp'>,
  ftp: { username: string; app?: string },
  ctx: OpsContext,
  opts: { reasonFa?: string } = {},
): Promise<GuardResult<Accepted>> {
  const plan = r3(
    {
      toolName: 'delete_ftp',
      titleFa: d.titleFtp(ftp.username),
      reasonFa: opts.reasonFa ?? d.defaultReason,
      target: ftp.app ? { app: ftp.app, resource: `ftp:${ftp.username}` } : { resource: ftp.username },
      impactFa: impact([], [d.ftpImpact]),
      command: `DELETE /v1/ftp/${ftp.username}`,
      params: { username: ftp.username },
    },
    ctx,
  );
  return guard(plan, ctx.approver, () => disks.deleteFtp(ftp.username), guardOptions(ctx));
}
