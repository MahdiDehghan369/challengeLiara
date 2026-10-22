import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { create as tarCreate } from 'tar';

export const ARCHIVE_WARN_BYTES = 200 * 1024 * 1024;

/** Always excluded, regardless of ignore files. `.env.example` is the only `.env*` that is kept. */
const ALWAYS_EXCLUDED_DIRS = new Set(['node_modules', '.git', '.siavash']);

export function isAlwaysExcluded(relPath: string): boolean {
  const parts = relPath.split('/');
  if (parts.some((p) => ALWAYS_EXCLUDED_DIRS.has(p))) return true;
  const base = parts[parts.length - 1] ?? '';
  return base.startsWith('.env') && base !== '.env.example';
}

interface IgnoreRule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}

function globToRegex(glob: string, anchored: boolean): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories; a trailing "**" matches everything below
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${anchored ? '^' : '^(?:.*/)?'}${re}(?:/.*)?$`);
}

/** Minimal .gitignore/.liaraignore parser: comments, `!` negation, trailing `/`, leading `/`, `*`, `**`, `?`. */
export function parseIgnore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/') || line.slice(0, -1).includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    if (!line) continue;
    rules.push({ re: globToRegex(line, anchored), negate, dirOnly });
  }
  return rules;
}

export function isIgnored(rules: IgnoreRule[], relPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    // ignored directories are pruned during the walk, so a dir-only rule never needs to match a file
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(relPath)) ignored = !r.negate;
  }
  return ignored;
}

function loadRules(projectPath: string): { rules: IgnoreRule[]; source: '.liaraignore' | '.gitignore' | 'none' } {
  for (const f of ['.liaraignore', '.gitignore'] as const) {
    const p = join(projectPath, f);
    if (existsSync(p)) return { rules: parseIgnore(readFileSync(p, 'utf8')), source: f };
  }
  return { rules: [], source: 'none' };
}

/** Lists files (POSIX relative paths) that would go into the archive. */
export function listSourceFiles(projectPath: string): { files: string[]; ignoreSource: string } {
  const { rules, source } = loadRules(projectPath);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = relative(projectPath, abs).split(sep).join('/');
      const isDir = e.isDirectory();
      if (isAlwaysExcluded(rel) || isIgnored(rules, rel, isDir)) continue;
      if (isDir) walk(abs);
      else if (e.isFile()) files.push(rel);
    }
  };
  walk(projectPath);
  files.sort();
  return { files, ignoreSource: source };
}

export interface SourceArchive {
  path: string;
  sizeBytes: number;
  fileCount: number;
  sha256: string;
  files: string[];
  ignoreSource: string;
  warnings: Array<{ code: 'ARCHIVE_TOO_LARGE'; sizeBytes: number }>;
}

async function sha256File(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** Builds `source.tar.gz` of the project in a fresh temp dir (Liara's sources endpoint takes a .gz file). */
export async function createSourceArchive(projectPath: string, opts: { outDir?: string } = {}): Promise<SourceArchive> {
  const { files, ignoreSource } = listSourceFiles(projectPath);
  const outDir = opts.outDir ?? mkdtempSync(join(tmpdir(), 'siavash-src-'));
  const path = join(outDir, 'source.tar.gz');
  await tarCreate({ gzip: true, file: path, cwd: projectPath, portable: true, noDirRecurse: true }, files);
  const sizeBytes = statSync(path).size;
  return {
    path,
    sizeBytes,
    fileCount: files.length,
    sha256: await sha256File(path),
    files,
    ignoreSource,
    warnings: sizeBytes > ARCHIVE_WARN_BYTES ? [{ code: 'ARCHIVE_TOO_LARGE', sizeBytes }] : [],
  };
}
