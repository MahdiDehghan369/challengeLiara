import { fa } from '../ui/cli/i18n/fa.js';
import { exists, hasDep, listFiles, pythonRequirements, readPackageJson, readText } from './project-files.js';
import type { AnalyzerWarning } from './types.js';

export type DbType = 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'sqlite';

export interface DatabaseNeed {
  type: DbType;
  /** Env var the app reads the connection from (existing one preferred). */
  envName: string;
  evidence: string[];
}

export interface DiskNeed {
  needed: boolean;
  /** Project-relative folders that must persist, e.g. `uploads`. */
  folders: string[];
  evidence: string[];
  // TODO(OQ-21): absolute mount path depends on the app's working dir inside Liara's container.
}

export interface MigrationNeed {
  tool: 'prisma' | 'django' | 'laravel' | 'sequelize' | 'typeorm' | 'knex';
  command: string;
  evidence: string;
}

export interface DepsDetection {
  needsDatabase: boolean;
  /** Main database first (relational/document before redis). */
  databases: DatabaseNeed[];
  disk: DiskNeed;
  migrations: MigrationNeed[];
  warnings: AnalyzerWarning[];
}

const NODE_DB_PACKAGES: Array<[string, DbType]> = [
  ['pg', 'postgres'],
  ['postgres', 'postgres'],
  ['mysql2', 'mysql'],
  ['mysql', 'mysql'],
  ['mongoose', 'mongodb'],
  ['mongodb', 'mongodb'],
  ['redis', 'redis'],
  ['ioredis', 'redis'],
  ['sqlite3', 'sqlite'],
  ['better-sqlite3', 'sqlite'],
];

const PY_DB_PACKAGES: Array<[string, DbType]> = [
  ['psycopg2', 'postgres'],
  ['psycopg2-binary', 'postgres'],
  ['psycopg', 'postgres'],
  ['asyncpg', 'postgres'],
  ['mysqlclient', 'mysql'],
  ['pymysql', 'mysql'],
  ['pymongo', 'mongodb'],
  ['motor', 'mongodb'],
  ['mongoengine', 'mongodb'],
  ['redis', 'redis'],
];

const PRISMA_PROVIDERS: Record<string, DbType> = {
  postgresql: 'postgres',
  postgres: 'postgres',
  mysql: 'mysql',
  mongodb: 'mongodb',
  sqlite: 'sqlite',
};

const UPLOAD_PACKAGES = ['multer', 'formidable', 'busboy', 'express-fileupload', '@fastify/multipart'];
const UPLOAD_FOLDERS = ['uploads', 'upload', 'media', 'public/uploads', 'storage/app'];

const ENV_CANDIDATES: Record<DbType, RegExp[]> = {
  postgres: [/^DATABASE_URL$/, /^POSTGRES(QL)?_URL$/, /^PG_?URL$/],
  mysql: [/^DATABASE_URL$/, /^MYSQL_URL$/],
  mongodb: [/^MONGO(DB)?_URI$/, /^MONGO(DB)?_URL$/, /^DATABASE_URL$/],
  redis: [/^REDIS_URL$/, /^REDIS_URI$/],
  sqlite: [/^DATABASE_URL$/],
};
const DEFAULT_ENV: Record<DbType, string> = {
  postgres: 'DATABASE_URL',
  mysql: 'DATABASE_URL',
  mongodb: 'MONGO_URI',
  redis: 'REDIS_URL',
  sqlite: 'DATABASE_URL',
};

export function detectDeps(root: string, knownEnvNames: string[] = []): DepsDetection {
  const found = new Map<DbType, { envName?: string; evidence: string[] }>();
  const add = (type: DbType, evidence: string, envName?: string) => {
    const e = found.get(type) ?? { evidence: [] };
    if (!e.evidence.includes(evidence)) e.evidence.push(evidence);
    if (envName && !e.envName) e.envName = envName;
    found.set(type, e);
  };
  const warnings: AnalyzerWarning[] = [];
  const migrations: MigrationNeed[] = [];

  // --- Node
  const pkg = readPackageJson(root);
  for (const [name, type] of NODE_DB_PACKAGES) if (hasDep(pkg, name)) add(type, `package.json: ${name}`);
  const prisma = readText(root, 'prisma/schema.prisma');
  if (prisma) {
    const provider = /provider\s*=\s*"(\w+)"/.exec(prisma.replace(/generator[\s\S]*?\}/g, ''))?.[1];
    const urlEnv = /url\s*=\s*env\("([A-Z_][A-Z0-9_]*)"\)/.exec(prisma)?.[1];
    const t = provider ? PRISMA_PROVIDERS[provider] : undefined;
    if (t) add(t, `prisma/schema.prisma: provider "${provider}"`, urlEnv);
    if (hasDep(pkg, 'prisma') || hasDep(pkg, '@prisma/client')) {
      migrations.push({ tool: 'prisma', command: 'npx prisma migrate deploy', evidence: 'prisma/schema.prisma' });
    }
  }
  if (hasDep(pkg, 'sequelize') && (hasDep(pkg, 'sequelize-cli') || exists(root, '.sequelizerc') || exists(root, 'migrations'))) {
    migrations.push({ tool: 'sequelize', command: 'npx sequelize-cli db:migrate', evidence: 'package.json: sequelize' });
  }
  if (hasDep(pkg, 'typeorm') && pkg?.scripts && Object.values(pkg.scripts).some((s) => s.includes('migration:run'))) {
    migrations.push({ tool: 'typeorm', command: 'npm run typeorm migration:run', evidence: 'package.json: typeorm migration script' });
  }
  if (hasDep(pkg, 'knex') && exists(root, 'migrations')) {
    migrations.push({ tool: 'knex', command: 'npx knex migrate:latest', evidence: 'migrations/' });
  }

  // --- Python
  const py = pythonRequirements(root);
  for (const [name, type] of PY_DB_PACKAGES) if (py.has(name)) add(type, `${py.get(name)}: ${name}`);
  const settings = listFiles(root, { exts: ['settings.py'], max: 20 });
  for (const f of settings) {
    const t = readText(root, f) ?? '';
    const engine = /django\.db\.backends\.(postgresql|mysql|sqlite3)/.exec(t)?.[1];
    if (engine) add(engine === 'sqlite3' ? 'sqlite' : engine === 'postgresql' ? 'postgres' : 'mysql', `${f}: ENGINE ${engine}`);
  }
  if (exists(root, 'manage.py')) {
    migrations.push({ tool: 'django', command: 'python manage.py migrate', evidence: 'manage.py' });
  }

  // --- Laravel
  if (exists(root, 'artisan')) {
    const conn = /^DB_CONNECTION=(\w+)/m.exec(readText(root, '.env.example') ?? '')?.[1];
    if (conn) {
      const t: DbType | undefined = conn === 'pgsql' ? 'postgres' : conn === 'mysql' || conn === 'mariadb' ? 'mysql' : conn === 'sqlite' ? 'sqlite' : undefined;
      if (t) add(t, `.env.example: DB_CONNECTION=${conn}`, 'DB_CONNECTION');
    }
    migrations.push({ tool: 'laravel', command: 'php artisan migrate --force', evidence: 'artisan' });
  }

  const order: DbType[] = ['postgres', 'mysql', 'mongodb', 'sqlite', 'redis'];
  const databases: DatabaseNeed[] = order
    .filter((t) => found.has(t))
    .map((type) => {
      const f = found.get(type) as { envName?: string; evidence: string[] };
      const existing = knownEnvNames.find((n) => ENV_CANDIDATES[type].some((re) => re.test(n)));
      return { type, envName: f.envName ?? existing ?? DEFAULT_ENV[type], evidence: f.evidence };
    });

  // --- Disk
  const diskEvidence: string[] = [];
  const folders: string[] = [];
  for (const p of UPLOAD_PACKAGES) if (hasDep(pkg, p) === 'dep') diskEvidence.push(`package.json: ${p}`);
  for (const d of UPLOAD_FOLDERS) {
    if (exists(root, d)) {
      folders.push(d);
      diskEvidence.push(`${d}/`);
    }
  }
  for (const f of settings) {
    const media = /MEDIA_ROOT\s*=\s*[^\n]*["']([\w./-]+)["']/.exec(readText(root, f) ?? '')?.[1];
    if (media) {
      diskEvidence.push(`${f}: MEDIA_ROOT`);
      if (!folders.includes(media)) folders.push(media);
    }
  }
  if (diskEvidence.length > 0) {
    if (folders.length === 0) folders.push('uploads');
    warnings.push({
      code: 'EPHEMERAL_FS',
      severity: 'warning',
      messageFa: fa.deps.ephemeralFs(diskEvidence[0] as string),
      fixFa: fa.deps.ephemeralFsFix(folders[0] as string),
      evidence: diskEvidence.join(', '),
    });
  }
  if (found.has('sqlite')) {
    warnings.push({
      code: 'SQLITE_EPHEMERAL',
      severity: 'warning',
      messageFa: fa.deps.sqlite,
      fixFa: fa.deps.sqliteFix,
      evidence: found.get('sqlite')?.evidence.join(', '),
    });
  }
  for (const m of migrations) {
    warnings.push({
      code: 'MIGRATION_NEEDED',
      severity: 'info',
      messageFa: fa.deps.migration(m.command),
      fixFa: fa.deps.migrationFix,
      evidence: m.evidence,
    });
  }

  return {
    needsDatabase: databases.some((d) => d.type !== 'redis'),
    databases,
    disk: { needed: diskEvidence.length > 0 || found.has('sqlite'), folders, evidence: diskEvidence },
    migrations,
    warnings,
  };
}
