import { z } from 'zod';
import { logger } from '../shared/logger.js';
import { Secret } from '../shared/secret.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { DbCreateInput, RunResult } from './cli.js';
import type { LiaraHttp } from './http.js';

/** CLI surface used for database lifecycle (implemented by LiaraCli). */
export interface DbCli {
  dbCreate(input: DbCreateInput): Promise<RunResult>;
  dbList(): Promise<unknown>;
  dbStart(name: string): Promise<RunResult>;
  dbStop(name: string): Promise<RunResult>;
  dbResize(name: string, plan: string, opts?: { confirmDiskIncrease?: boolean }): Promise<RunResult>;
  dbRemove(name: string): Promise<RunResult>;
}

// specs/dbaas.yaml (DBs-details / DB-details). Used only by getDbConnection — spec-only endpoints, see OQ-12.
const DbListSchema = z.object({
  databases: z
    .array(z.object({ id: z.string().optional(), DBId: z.string().optional(), hostname: z.string().optional() }).passthrough())
    .default([]),
});

const DbDetailsSchema = z.object({
  database: z
    .object({
      type: z.string().optional(),
      hostname: z.string().optional(),
      publicNetwork: z.boolean().optional(),
      dbName: z.string().optional(),
      node: z.object({ host: z.string().optional() }).passthrough().optional(),
      port: z.coerce.number().optional(),
      internalPort: z.coerce.number().optional(),
      root_password: z.string().optional(),
      username: z.string().optional(),
    })
    .passthrough(),
});

export type DbKind = 'postgres' | 'mysql' | 'mariadb' | 'mongodb';

export interface ConnectionParts {
  host: string;
  port: number;
  user: string;
  password: Secret<string>;
  database?: string | undefined;
}

const DEFAULT_PORT: Record<DbKind, number> = { postgres: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 };

export function normalizeDbKind(type: string): DbKind | undefined {
  const t = type.toLowerCase();
  if (t.startsWith('postgres') || t === 'pg') return 'postgres';
  if (t === 'mysql') return 'mysql';
  if (t === 'mariadb') return 'mariadb';
  if (t.startsWith('mongo')) return 'mongodb';
  return undefined;
}

/** Builds a connection string; the result is a Secret because it embeds the password. */
export function buildConnectionString(type: DbKind, parts: ConnectionParts): Secret<string> {
  const user = encodeURIComponent(parts.user);
  const pass = encodeURIComponent(parts.password.reveal());
  const host = `${parts.host}:${parts.port || DEFAULT_PORT[type]}`;
  const db = parts.database ? `/${encodeURIComponent(parts.database)}` : '';
  switch (type) {
    case 'postgres':
      return new Secret(`postgresql://${user}:${pass}@${host}${db}`);
    case 'mysql':
    case 'mariadb':
      return new Secret(`mysql://${user}:${pass}@${host}${db}`);
    case 'mongodb':
      return new Secret(`mongodb://${user}:${pass}@${host}${db || '/'}?authSource=admin`);
  }
}

export type DbConnection =
  | {
      status: 'ok';
      type: string;
      /** Address reachable from apps inside Liara (hostname + internal port). */
      internal: { host: string; port: number } | undefined;
      /** Public address, only when public networking is on. */
      public: { host: string; port: number } | undefined;
      username: string;
      password: Secret<string>;
      database: string | undefined;
      connectionString: Secret<string> | undefined;
    }
  | { status: 'needs-human'; instructionFa: string; reason: string };

export class DbApi {
  constructor(
    private readonly cli: DbCli,
    private readonly http: LiaraHttp,
  ) {}

  createDb(input: DbCreateInput): Promise<RunResult> {
    return this.cli.dbCreate({ publicNetwork: false, ...input });
  }

  /** `liara db list --output json` — raw until T0.5 records its shape. */
  listDbs(): Promise<unknown> {
    return this.cli.dbList();
  }

  startDb(name: string): Promise<RunResult> {
    return this.cli.dbStart(name);
  }

  stopDb(name: string): Promise<RunResult> {
    return this.cli.dbStop(name);
  }

  resizeDb(name: string, plan: string, opts: { confirmDiskIncrease?: boolean } = {}): Promise<RunResult> {
    return this.cli.dbResize(name, plan, opts);
  }

  removeDb(name: string): Promise<RunResult> {
    return this.cli.dbRemove(name);
  }

  /**
   * Connection details via the dbaas spec endpoints (`GET /v1/databases` → `GET /v1/databases/{id}`).
   * TODO(OQ-12): spec-only — the name→id match uses `hostname` (the create field), and internal vs
   * public address semantics are unconfirmed. Any failure → `needs-human` (copy from the panel).
   */
  async getDbConnection(name: string): Promise<DbConnection> {
    const human = (reason: string): DbConnection => ({
      status: 'needs-human',
      instructionFa: fa.db.needsHuman(name),
      reason,
    });
    try {
      const list = await this.http.get('/v1/databases', { schema: DbListSchema, operationId: 'db.list' });
      const item = list.databases.find((d) => d.hostname === name);
      const id = item?.id ?? item?.DBId;
      if (!id) return human('database not found in GET /v1/databases');
      const { database: d } = await this.http.get(`/v1/databases/${encodeURIComponent(id)}`, {
        schema: DbDetailsSchema,
        operationId: 'db.get',
      });
      if (!d.root_password) return human('no password in database details');
      const kind = normalizeDbKind(d.type ?? '');
      const internal = d.hostname && d.internalPort ? { host: d.hostname, port: d.internalPort } : undefined;
      const pub = d.publicNetwork && d.node?.host && d.port ? { host: d.node.host, port: d.port } : undefined;
      const addr = internal ?? pub;
      const username = d.username ?? 'root';
      const password = new Secret(d.root_password);
      return {
        status: 'ok',
        type: d.type ?? 'unknown',
        internal,
        public: pub,
        username,
        password,
        database: d.dbName,
        connectionString:
          kind && addr
            ? buildConnectionString(kind, { ...addr, user: username, password, database: d.dbName })
            : undefined,
      };
    } catch (e) {
      logger.debug({ name, err: e instanceof Error ? e.message : String(e) }, 'db connection lookup failed');
      return human(e instanceof Error ? e.message : 'lookup failed');
    }
  }
}
