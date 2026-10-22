import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectEnv, type EnvVarFinding } from '../../../src/analyzer/detect-env.js';
import { project } from '../../helpers/projects.js';

function tmpProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'siavash-env-'));
  for (const [rel, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), c);
  }
  return root;
}
const byName = (vars: EnvVarFinding[]) => Object.fromEntries(vars.map((v) => [v.name, v]));

describe('detectEnv', () => {
  it('express fixture: required vs optional, secrets, agent-managed, sources', () => {
    const v = byName(detectEnv(project('express-api')).vars);
    expect(v.DATABASE_URL).toMatchObject({ required: true, isSecret: true, hasDefault: false });
    expect(v.DATABASE_URL?.sources).toEqual(expect.arrayContaining(['.env.example', expect.stringMatching(/^index\.js:\d+$/)]));
    expect(v.JWT_SECRET).toMatchObject({ required: true, isSecret: true });
    expect(v.APP_NAME).toMatchObject({ required: false, hasDefault: true, suggestedValue: 'shop', isSecret: false });
    expect(v.FEATURE_FLAG).toMatchObject({ required: false, hasDefault: true });
    expect(v.PORT).toMatchObject({ managedByAgent: true, required: false });
  });

  it('required variables are listed first', () => {
    const vars = detectEnv(project('express-api')).vars;
    const firstOptional = vars.findIndex((x) => !x.required);
    expect(vars.slice(firstOptional).every((x) => !x.required)).toBe(true);
  });

  it('python: os.environ["X"] is required, os.getenv with default is not', () => {
    const v = byName(detectEnv(project('django-app')).vars);
    expect(v.DJANGO_SECRET_KEY).toMatchObject({ required: true, isSecret: true });
    expect(v.DEBUG).toMatchObject({ required: false, hasDefault: true });
  });

  it('fastapi os.getenv without default at module level → required', () => {
    expect(byName(detectEnv(project('fastapi-app')).vars).MONGO_URI).toMatchObject({ required: true, isSecret: true });
  });

  it('laravel env() with default, and .env.example keys', () => {
    const v = byName(detectEnv(project('laravel-app')).vars);
    expect(v.APP_NAME).toMatchObject({ hasDefault: true, required: false });
    expect(v.APP_KEY).toMatchObject({ isSecret: true, required: true });
    expect(v.DB_CONNECTION).toMatchObject({ suggestedValue: 'mysql', required: false });
    expect(v.DB_PASSWORD).toMatchObject({ isSecret: true, required: true });
  });

  it('secret example values are never offered as suggestions', () => {
    const root = tmpProject({ '.env.example': 'API_KEY=example-key-123\nMODE=fast\n' });
    const v = byName(detectEnv(root).vars);
    expect(v.API_KEY?.suggestedValue).toBeUndefined();
    expect(v.MODE?.suggestedValue).toBe('fast');
  });

  it('function-scoped usage without default is optional; vendor dirs are skipped', () => {
    const root = tmpProject({
      'lib/util.js': 'function f() {\n  return process.env.LAZY_VAR;\n}\n',
      'node_modules/x/index.js': 'process.env.FROM_DEP\n',
    });
    const v = byName(detectEnv(root).vars);
    expect(v.LAZY_VAR).toMatchObject({ required: false });
    expect(v.FROM_DEP).toBeUndefined();
  });

  it('reads the real .env only when allowed, as Secrets', () => {
    const root = tmpProject({ '.env': 'DATABASE_URL="postgres://u:p@h/db"\n# c\nX=1 # comment\n' });
    expect(detectEnv(root).dotenv).toBeUndefined();
    const d = detectEnv(root, { readDotEnv: true }).dotenv;
    expect(d?.get('DATABASE_URL')?.reveal()).toBe('postgres://u:p@h/db');
    expect(d?.get('X')?.reveal()).toBe('1');
    expect(JSON.stringify([...(d ?? new Map()).values()])).not.toContain('postgres');
  });
});
