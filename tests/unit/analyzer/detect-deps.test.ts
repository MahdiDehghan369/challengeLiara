import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectDeps } from '../../../src/analyzer/detect-deps.js';
import { project } from '../../helpers/projects.js';

function tmpProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'siavash-deps-'));
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), c);
  }
  return root;
}

describe('detectDeps', () => {
  it('express: pg → postgres via DATABASE_URL; multer + uploads/ → disk warning', () => {
    const r = detectDeps(project('express-api'), ['DATABASE_URL', 'JWT_SECRET']);
    expect(r.needsDatabase).toBe(true);
    expect(r.databases).toEqual([{ type: 'postgres', envName: 'DATABASE_URL', evidence: ['package.json: pg'] }]);
    expect(r.disk.needed).toBe(true);
    expect(r.disk.folders).toEqual(['uploads']);
    expect(r.disk.evidence).toEqual(['package.json: multer', 'uploads/']);
    const w = r.warnings.find((x) => x.code === 'EPHEMERAL_FS');
    expect(w?.fixFa).toContain('uploads');
  });

  it('nest + prisma: provider and url env from schema; prisma migration', () => {
    const r = detectDeps(project('nest-api'));
    expect(r.databases[0]).toMatchObject({ type: 'postgres', envName: 'DATABASE_URL' });
    expect(r.databases[0]?.evidence).toContain('prisma/schema.prisma: provider "postgresql"');
    expect(r.migrations).toEqual([{ tool: 'prisma', command: 'npx prisma migrate deploy', evidence: 'prisma/schema.prisma' }]);
  });

  it('django: psycopg2 → postgres, manage.py migrate, MEDIA_ROOT → disk', () => {
    const r = detectDeps(project('django-app'));
    expect(r.databases.map((d) => d.type)).toEqual(['postgres']);
    expect(r.migrations.map((m) => m.command)).toEqual(['python manage.py migrate']);
    expect(r.disk.folders).toContain('media');
  });

  it('flask: redis alone does not count as a database', () => {
    const r = detectDeps(project('flask-app'), ['REDIS_URL']);
    expect(r.databases).toEqual([{ type: 'redis', envName: 'REDIS_URL', evidence: ['requirements.txt: redis'] }]);
    expect(r.needsDatabase).toBe(false);
  });

  it('fastapi: pymongo from pyproject → mongodb, prefers the env name the code uses', () => {
    const r = detectDeps(project('fastapi-app'), ['MONGO_URI']);
    expect(r.databases[0]).toMatchObject({ type: 'mongodb', envName: 'MONGO_URI' });
    expect(r.databases[0]?.evidence[0]).toMatch(/^pyproject\.toml: pymongo$/);
  });

  it('laravel: DB_CONNECTION=mysql + artisan migrate', () => {
    const r = detectDeps(project('laravel-app'));
    expect(r.databases[0]).toMatchObject({ type: 'mysql', envName: 'DB_CONNECTION' });
    expect(r.migrations[0]?.command).toBe('php artisan migrate --force');
  });

  it('sqlite → warning and disk needed', () => {
    const root = tmpProject({ 'package.json': JSON.stringify({ dependencies: { 'better-sqlite3': '9' } }) });
    const r = detectDeps(root);
    expect(r.warnings.map((w) => w.code)).toContain('SQLITE_EPHEMERAL');
    expect(r.disk.needed).toBe(true);
  });

  it('static site: nothing needed', () => {
    const r = detectDeps(project('static-site'));
    expect(r).toMatchObject({ needsDatabase: false, databases: [], migrations: [], warnings: [] });
    expect(r.disk.needed).toBe(false);
  });

  it('every need carries evidence', () => {
    for (const name of ['express-api', 'nest-api', 'django-app', 'fastapi-app', 'laravel-app']) {
      const r = detectDeps(project(name));
      for (const d of r.databases) expect(d.evidence.length).toBeGreaterThan(0);
      for (const m of r.migrations) expect(m.evidence).toBeTruthy();
      if (r.disk.needed) expect(r.disk.evidence.length + r.databases.length).toBeGreaterThan(0);
    }
  });
});
