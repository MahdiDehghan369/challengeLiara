import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { list as tarList } from 'tar';
import { describe, expect, it } from 'vitest';
import {
  createSourceArchive,
  isAlwaysExcluded,
  isIgnored,
  listSourceFiles,
  parseIgnore,
} from '../../../src/liara/archive.js';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'siavash-proj-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

async function entriesOf(tgz: string): Promise<string[]> {
  const out: string[] = [];
  await tarList({ file: tgz, onReadEntry: (e) => out.push(e.path) });
  return out.sort();
}

const BASE_FILES = {
  'package.json': '{}',
  'index.js': 'console.log(1)',
  'src/app.js': '',
  '.env': 'SECRET=1',
  '.env.local': 'SECRET=2',
  '.env.production': 'SECRET=3',
  '.env.example': 'APP_NAME=',
  'config/.env': 'NESTED=1',
  'node_modules/x/index.js': '',
  '.git/HEAD': 'ref',
  '.siavash/state.json': '{}',
};

describe('archive', () => {
  it('always excludes node_modules, .git, .siavash and .env* (except .env.example)', () => {
    expect(isAlwaysExcluded('node_modules/a.js')).toBe(true);
    expect(isAlwaysExcluded('packages/a/node_modules/b.js')).toBe(true);
    expect(isAlwaysExcluded('.git')).toBe(true);
    expect(isAlwaysExcluded('.siavash/x')).toBe(true);
    expect(isAlwaysExcluded('.env')).toBe(true);
    expect(isAlwaysExcluded('config/.env.local')).toBe(true);
    expect(isAlwaysExcluded('.env.example')).toBe(false);
    expect(isAlwaysExcluded('src/env.js')).toBe(false);
  });

  it('no .env file ends up in the archive, .env.example does', async () => {
    const root = project(BASE_FILES);
    const a = await createSourceArchive(root);
    const entries = await entriesOf(a.path);
    expect(entries.filter((e) => /(^|\/)\.env/.test(e))).toEqual(['.env.example']);
    expect(entries).toEqual(['.env.example', 'index.js', 'package.json', 'src/app.js']);
    expect(a.fileCount).toBe(4);
    expect(a.sizeBytes).toBeGreaterThan(0);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.warnings).toEqual([]);
    expect(a.path.endsWith('source.tar.gz')).toBe(true);
  });

  it('honours .liaraignore over .gitignore', () => {
    const root = project({
      ...BASE_FILES,
      '.liaraignore': 'dist/\n*.log\n',
      '.gitignore': 'src/\n',
      'dist/bundle.js': '',
      'debug.log': '',
      'logs/app.log': '',
    });
    const { files, ignoreSource } = listSourceFiles(root);
    expect(ignoreSource).toBe('.liaraignore');
    expect(files).toEqual(['.env.example', '.gitignore', '.liaraignore', 'index.js', 'package.json', 'src/app.js']);
  });

  it('falls back to .gitignore when there is no .liaraignore', () => {
    const root = project({ ...BASE_FILES, '.gitignore': '/build\ncoverage/\n!keep.log\n*.log\n', 'build/x': '', 'a/build/y': '', 'coverage/c': '', 'x.log': '' });
    const { files, ignoreSource } = listSourceFiles(root);
    expect(ignoreSource).toBe('.gitignore');
    expect(files).toContain('a/build/y');
    expect(files).not.toContain('build/x');
    expect(files).not.toContain('coverage/c');
    expect(files).not.toContain('x.log');
  });

  it('ignore rules: globs, **, negation, anchoring, dir-only', () => {
    const rules = parseIgnore('# c\n*.tmp\n**/cache/**\n/root-only.txt\nout/\n!important.tmp\n');
    expect(isIgnored(rules, 'a.tmp', false)).toBe(true);
    expect(isIgnored(rules, 'deep/b.tmp', false)).toBe(true);
    expect(isIgnored(rules, 'important.tmp', false)).toBe(false);
    expect(isIgnored(rules, 'x/cache/y.js', false)).toBe(true);
    expect(isIgnored(rules, 'root-only.txt', false)).toBe(true);
    expect(isIgnored(rules, 'sub/root-only.txt', false)).toBe(false);
    expect(isIgnored(rules, 'out', true)).toBe(true);
    expect(isIgnored(rules, 'out', false)).toBe(false);
  });
});
