import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Small helpers for reading a user's project safely (missing/invalid files never throw). */

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'vendor',
  '.venv',
  'venv',
  '__pycache__',
  'dist',
  'build',
  '.next',
  '.siavash',
]);

export function readText(root: string, rel: string): string | undefined {
  const p = join(root, rel);
  try {
    return statSync(p).isFile() ? readFileSync(p, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

export function readJson<T = Record<string, unknown>>(root: string, rel: string): T | undefined {
  const t = readText(root, rel);
  if (t === undefined) return undefined;
  try {
    return JSON.parse(t) as T;
  } catch {
    return undefined;
  }
}

export function exists(root: string, rel: string): boolean {
  return existsSync(join(root, rel));
}

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  main?: string;
}

export function readPackageJson(root: string): PackageJson | undefined {
  return readJson<PackageJson>(root, 'package.json');
}

export function hasDep(pkg: PackageJson | undefined, name: string): 'dep' | 'dev' | undefined {
  if (pkg?.dependencies?.[name] !== undefined) return 'dep';
  if (pkg?.devDependencies?.[name] !== undefined) return 'dev';
  return undefined;
}

/**
 * Python package names (lower-case) → file they were found in, from requirements*.txt,
 * pyproject.toml and Pipfile. Used for membership checks of known packages only.
 */
export function pythonRequirements(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of ['requirements.txt', 'requirements/base.txt', 'requirements/prod.txt']) {
    const t = readText(root, f);
    if (!t) continue;
    for (const line of t.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_.-]+)/.exec(line.replace(/#.*/, ''));
      if (m) out.set((m[1] as string).toLowerCase(), f);
    }
  }
  for (const f of ['pyproject.toml', 'Pipfile']) {
    const t = readText(root, f);
    if (!t) continue;
    // `django = "^4.2"` (poetry / Pipfile)
    for (const m of t.matchAll(/^\s*([A-Za-z][A-Za-z0-9_.-]*)\s*=/gm)) out.set((m[1] as string).toLowerCase(), f);
    // `"django>=4.2"` (PEP 621 dependency lists)
    for (const m of t.matchAll(/["']([A-Za-z][A-Za-z0-9_.-]*)\s*(?:[<>=~^!]|["'])/g)) {
      out.set((m[1] as string).toLowerCase(), f);
    }
  }
  return out;
}

/** Lists files (relative POSIX paths) up to `max`, skipping vendor/build/hidden dirs. */
export function listFiles(root: string, opts: { exts?: string[]; max?: number } = {}): string[] {
  const max = opts.max ?? 5_000;
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= max) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= max) return;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name));
      } else if (e.isFile()) {
        if (!opts.exts || opts.exts.some((x) => e.name.endsWith(x))) {
          out.push(relative(root, join(dir, e.name)).split(sep).join('/'));
        }
      }
    }
  };
  walk(root);
  return out.sort();
}
