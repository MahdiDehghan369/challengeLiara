import { z } from 'zod';
import { LiaraApiError } from '../../shared/errors.js';
import { Secret } from '../../shared/secret.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Accepted, LiaraHttp } from '../http.js';
import type { AppsApi } from './apps.js';
import { AcceptedSchema } from './schemas/apps.js';

// Schemas follow specs/paas.yaml (Get-disks, Get-disk-backup, ftp). Numbers may arrive as strings.
export const DisksResponseSchema = z.object({
  disks: z
    .array(
      z
        .object({
          _id: z.string().optional(),
          name: z.string(),
          size: z.coerce.number().optional(),
          updatedAt: z.string().optional(),
          createdAt: z.string().optional(),
        })
        .passthrough(),
    )
    .default([]),
  mounts: z.array(z.object({ name: z.string(), mountedTo: z.string() }).passthrough()).default([]),
});

export const BackupsResponseSchema = z.object({
  backups: z
    .array(
      z
        .object({
          name: z.string(),
          lastModified: z.string().optional(),
          etag: z.string().optional(),
          size: z.coerce.number().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

export const BackupLinkResponseSchema = z.object({ link: z.string().min(1) });

const FtpAccessSchema = z
  .object({
    _id: z.string(),
    disk: z.string().optional(),
    username: z.string(),
    password: z.string().optional(),
    readOnly: z.boolean().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export const FtpListResponseSchema = z.object({
  accesses: z.array(FtpAccessSchema).default([]),
  host: z.string().optional(),
});

export const FtpCreateResponseSchema = z.object({
  username: z.string(),
  password: z.string(),
  host: z.string().optional(),
});

export interface Disk {
  id: string | undefined;
  name: string;
  /** As reported by Liara (GB per the CLI docs; unconfirmed for the API). */
  size: number | undefined;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  mountedTo: string | undefined;
}

export interface Backup {
  name: string;
  lastModified: string | undefined;
  etag: string | undefined;
  size: number | undefined;
}

export interface FtpAccess {
  id: string;
  disk: string | undefined;
  username: string;
  password: Secret<string> | undefined;
  readOnly: boolean | undefined;
  createdAt: string | undefined;
}

export interface FtpCredentials {
  username: string;
  password: Secret<string>;
  host: string | undefined;
}

const enc = encodeURIComponent;

/**
 * Disks / backups / FTP exactly per the map: list/delete disk and all backup routes take `{id}`
 * (resolved from the app name); create/resize disk and FTP list/create take `{name}`.
 */
export class DisksApi {
  constructor(
    private readonly http: LiaraHttp,
    private readonly apps: AppsApi,
  ) {}

  private async id(app: string): Promise<string> {
    return (await this.apps.resolveApp(app)).id;
  }

  /** `GET /v1/projects/{id}/disks` → disks + mount points. */
  async listDisks(app: string): Promise<{ disks: Disk[]; mounts: Array<{ name: string; mountedTo: string }> }> {
    const r = await this.http.get(`/v1/projects/${enc(await this.id(app))}/disks`, {
      schema: DisksResponseSchema,
      operationId: 'disks.list',
    });
    const mountOf = new Map(r.mounts.map((m) => [m.name, m.mountedTo]));
    return {
      disks: r.disks.map((d) => ({
        id: d._id,
        name: d.name,
        size: d.size,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        mountedTo: mountOf.get(d.name),
      })),
      mounts: r.mounts.map((m) => ({ name: m.name, mountedTo: m.mountedTo })),
    };
  }

  /** `POST /v1/projects/{name}/disks` `{name, size: string}` → 201. */
  async createDisk(app: string, disk: { name: string; size: number | string }): Promise<Accepted> {
    await this.http.post(`/v1/projects/${enc(app)}/disks`, {
      body: { name: disk.name, size: String(disk.size) },
      schema: AcceptedSchema,
      operationId: 'disks.create',
    });
    return { accepted: true };
  }

  /** `POST /v1/projects/{name}/disks/{dname}/resize` `{size: string}`. */
  async resizeDisk(app: string, disk: string, size: number | string): Promise<Accepted> {
    await this.http.post(`/v1/projects/${enc(app)}/disks/${enc(disk)}/resize`, {
      body: { size: String(size) },
      schema: AcceptedSchema,
      operationId: 'disks.resize',
    });
    return { accepted: true };
  }

  /** `DELETE /v1/projects/{id}/disks/{name}`; 409 → `DISK_IN_USE`. */
  async deleteDisk(app: string, disk: string): Promise<Accepted> {
    try {
      await this.http.delete(`/v1/projects/${enc(await this.id(app))}/disks/${enc(disk)}`, {
        schema: AcceptedSchema,
        operationId: 'disks.delete',
      });
    } catch (e) {
      if (e instanceof LiaraApiError && e.status === 409) {
        throw new LiaraApiError(`Disk in use: ${disk}`, {
          code: 'DISK_IN_USE',
          status: 409,
          operationId: 'disks.delete',
          messageFa: fa.disks.inUse(disk),
          details: { app, disk },
          cause: e,
        });
      }
      throw e;
    }
    return { accepted: true };
  }

  /** `GET /v1/projects/{id}/disks/{name}/backups`. */
  async listBackups(app: string, disk: string): Promise<Backup[]> {
    const r = await this.http.get(`/v1/projects/${enc(await this.id(app))}/disks/${enc(disk)}/backups`, {
      schema: BackupsResponseSchema,
      operationId: 'backups.list',
    });
    return r.backups.map((b) => ({ name: b.name, lastModified: b.lastModified, etag: b.etag, size: b.size }));
  }

  /** `POST /v1/projects/{id}/disks/{name}/backups`. */
  async createBackup(app: string, disk: string): Promise<Accepted> {
    await this.http.post(`/v1/projects/${enc(await this.id(app))}/disks/${enc(disk)}/backups`, {
      schema: AcceptedSchema,
      operationId: 'backups.create',
    });
    return { accepted: true };
  }

  /** `POST /v1/projects/{id}/disks/{dname}/backups/{bname}/download` → signed link (kept as Secret). */
  async getBackupDownloadLink(app: string, disk: string, backup: string): Promise<Secret<string>> {
    const r = await this.http.post(
      `/v1/projects/${enc(await this.id(app))}/disks/${enc(disk)}/backups/${enc(backup)}/download`,
      { schema: BackupLinkResponseSchema, operationId: 'backups.download' },
    );
    return new Secret(r.link);
  }

  /** `GET /v1/projects/{name}/disks/{dname}/ftp` — passwords wrapped in Secret. */
  async listFtp(app: string, disk: string): Promise<{ host: string | undefined; accesses: FtpAccess[] }> {
    const r = await this.http.get(`/v1/projects/${enc(app)}/disks/${enc(disk)}/ftp`, {
      schema: FtpListResponseSchema,
      operationId: 'ftp.list',
    });
    return {
      host: r.host,
      accesses: r.accesses.map((a) => ({
        id: a._id,
        disk: a.disk,
        username: a.username,
        password: a.password === undefined ? undefined : new Secret(a.password),
        readOnly: a.readOnly,
        createdAt: a.createdAt,
      })),
    };
  }

  /** `POST /v1/projects/{name}/disks/{dname}/ftp` `{username, readOnly}` → credentials (password as Secret). */
  async createFtp(app: string, disk: string, input: { username: string; readOnly: boolean }): Promise<FtpCredentials> {
    const r = await this.http.post(`/v1/projects/${enc(app)}/disks/${enc(disk)}/ftp`, {
      body: { username: input.username, readOnly: input.readOnly },
      schema: FtpCreateResponseSchema,
      operationId: 'ftp.create',
    });
    return { username: r.username, password: new Secret(r.password), host: r.host };
  }

  /** `DELETE /v1/ftp/{fname}`. */
  async deleteFtp(ftpName: string): Promise<Accepted> {
    await this.http.delete(`/v1/ftp/${enc(ftpName)}`, { schema: AcceptedSchema, operationId: 'ftp.delete' });
    return { accepted: true };
  }
}
