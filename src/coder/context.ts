import { posix } from 'node:path';
import { listFiles, readText } from '../analyzer/project-files.js';
import { redactText } from '../safety/redact.js';
import type { StackFrame } from '../sre/log-cluster.js';

/**
 * Collects the code an LLM needs to diagnose an error (T8.7): the code around user stack frames,
 * their direct local imports and the project manifest; falls back to searching the code for the
 * route or error message. Everything is redacted and capped.
 */

export type SnippetReason = 'frame' | 'manifest' | 'import' | 'search';

export interface CodeSnippet {
  /** Path relative to the project root (POSIX). */
  path: string;
  startLine: number;
  endLine: number;
  /** The line the error points to (frames) or the search hit. */
  focusLine?: number;
  reason: SnippetReason;
  /** Redacted content of lines startLine..endLine. */
  content: string;
}

export interface CodeContext {
  snippets: CodeSnippet[];
  totalChars: number;
  truncated: boolean;
  /** Frame paths that could not be mapped to a local file. */
  unresolved: string[];
}

export interface ContextInput {
  frames?: StackFrame[];
  /** Error message (header line) used for searching when there is no usable stack. */
  message?: string;
  /** Request route, e.g. `/api/orders/:id`. */
  route?: string;
}

export interface ContextOptions {
  maxChars?: number;
  /** Lines before/after the error line. */
  window?: number;
  /** Max distinct frame files. */
  maxFrameFiles?: number;
}

const CODE_EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.php'];
const MANIFESTS = ['package.json', 'requirements.txt', 'pyproject.toml', 'composer.json'];

/**
 * Maps a container path (`/usr/src/app/src/x.js`, `/app/...`, `file:///app/...`) to a local file by
 * the longest matching path suffix. A bare basename match is accepted only if it is unique.
 */
export function mapContainerPath(containerPath: string, localFiles: string[]): string | undefined {
  const segs = containerPath
    .replace(/^file:\/\//, '')
    .split(/[\\/]/)
    .filter(Boolean);
  const set = new Set(localFiles);
  for (let k = segs.length; k >= 2; k--) {
    const suffix = segs.slice(-k).join('/');
    if (set.has(suffix)) return suffix;
  }
  const base = segs[segs.length - 1];
  if (!base) return undefined;
  const hits = localFiles.filter((f) => posix.basename(f) === base);
  return hits.length === 1 ? hits[0] : undefined;
}

function sliceLines(text: string, start: number, end: number): string {
  return text.split('\n').slice(start - 1, end).join('\n');
}

function lineCount(text: string): number {
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

const JS_IMPORT_RE = /(?:require\(\s*|import\s*\(\s*|from\s+|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const PY_IMPORT_RE = /^\s*from\s+(\.*[\w.]*)\s+import\s+|^\s*import\s+([\w.]+)/gm;

/** Direct local imports of `file`, resolved to existing project files. */
export function resolveLocalImports(file: string, text: string, localFiles: string[]): string[] {
  const set = new Set(localFiles);
  const dir = posix.dirname(file);
  const out = new Set<string>();
  const tryAdd = (base: string, exts: string[]) => {
    for (const ext of exts) {
      const p = posix.normalize(base + ext);
      if (set.has(p) && p !== file) {
        out.add(p);
        return;
      }
    }
  };
  if (file.endsWith('.py')) {
    for (const m of text.matchAll(PY_IMPORT_RE)) {
      const mod = m[1] ?? m[2];
      if (!mod || mod === '.') continue;
      const dots = /^\.*/.exec(mod)?.[0].length ?? 0;
      const rest = mod.slice(dots).replace(/\./g, '/');
      let baseDir = dots > 0 ? dir : '';
      for (let i = 1; i < dots; i++) baseDir = posix.dirname(baseDir);
      tryAdd(posix.join(baseDir, rest), ['.py', '/__init__.py']);
    }
  } else {
    for (const m of text.matchAll(JS_IMPORT_RE)) {
      const spec = (m[1] as string).replace(/\.js$/, '');
      tryAdd(posix.join(dir, spec), ['', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '/index.js', '/index.ts']);
    }
  }
  return [...out];
}

/** Search terms derived from a route and an error message (most specific first). */
export function searchTerms(input: ContextInput): string[] {
  const terms: string[] = [];
  if (input.route) {
    const route = input.route.split('?')[0] as string;
    terms.push(route);
    const segs = route.split('/').filter(Boolean);
    // routers are often mounted on a prefix: also try the tail segments
    for (let k = segs.length - 1; k >= 1; k--) terms.push('/' + segs.slice(-k).join('/'));
  }
  if (input.message) {
    const msg = input.message.replace(/^\w*(?:Error|Exception)\w*:\s*/, '').trim();
    if (msg.length >= 6 && msg.length <= 120) terms.push(msg);
    for (const m of input.message.matchAll(/['"`]([^'"`\s][^'"`]{2,60})['"`]/g)) terms.push(m[1] as string);
  }
  return [...new Set(terms)];
}

export function collectCodeContext(root: string, input: ContextInput, opts: ContextOptions = {}): CodeContext {
  const maxChars = opts.maxChars ?? 20_000;
  const window = opts.window ?? 60;
  const files = listFiles(root);
  const codeFiles = files.filter((f) => CODE_EXTS.some((e) => f.endsWith(e)));
  const snippets: CodeSnippet[] = [];
  const unresolved: string[] = [];
  let total = 0;
  let truncated = false;
  const included = new Set<string>();

  const add = (s: Omit<CodeSnippet, 'content'>, raw: string): boolean => {
    if (total >= maxChars) {
      truncated = true;
      return false;
    }
    let content = redactText(raw);
    if (total + content.length > maxChars) {
      content = content.slice(0, maxChars - total);
      truncated = true;
    }
    snippets.push({ ...s, content });
    total += content.length;
    return true;
  };

  // 1) user stack frames: ±window lines around the error line, one snippet per file
  const frameFiles: { path: string; text: string }[] = [];
  for (const f of input.frames ?? []) {
    if (!f.isUserCode) continue;
    const local = mapContainerPath(f.file, files);
    if (!local) {
      unresolved.push(f.file);
      continue;
    }
    if (included.has(local)) continue;
    if (frameFiles.length >= (opts.maxFrameFiles ?? 3)) break;
    const text = readText(root, local);
    if (text === undefined) continue;
    const n = lineCount(text);
    const line = f.line && f.line <= n ? f.line : 1;
    const startLine = Math.max(1, line - window);
    const endLine = Math.min(n, line + window);
    included.add(local);
    frameFiles.push({ path: local, text });
    add({ path: local, startLine, endLine, focusLine: line, reason: 'frame' }, sliceLines(text, startLine, endLine));
  }

  // 2) search by route / message when no frame resolved
  if (frameFiles.length === 0) {
    const hitFiles: { path: string; text: string }[] = [];
    for (const term of searchTerms(input)) {
      if (hitFiles.length >= 3) break;
      for (const path of codeFiles) {
        if (included.has(path) || hitFiles.length >= 3) continue;
        const text = readText(root, path);
        if (!text) continue;
        const idx = text.split('\n').findIndex((l) => l.includes(term));
        if (idx < 0) continue;
        const n = lineCount(text);
        const line = idx + 1;
        const startLine = Math.max(1, line - window);
        const endLine = Math.min(n, line + window);
        included.add(path);
        hitFiles.push({ path, text });
        add({ path, startLine, endLine, focusLine: line, reason: 'search' }, sliceLines(text, startLine, endLine));
      }
    }
    frameFiles.push(...hitFiles);
  }

  // 3) project manifest
  const projectDir = frameFiles[0] ? findManifestDir(root, frameFiles[0].path) : '';
  for (const m of MANIFESTS) {
    const rel = projectDir ? `${projectDir}/${m}` : m;
    const text = readText(root, rel);
    if (text === undefined) continue;
    add({ path: rel, startLine: 1, endLine: lineCount(text), reason: 'manifest' }, text);
    break;
  }

  // 4) direct local imports of the primary file
  const primary = frameFiles[0];
  if (primary) {
    for (const imp of resolveLocalImports(primary.path, primary.text, files)) {
      if (included.has(imp)) continue;
      const text = readText(root, imp);
      if (text === undefined) continue;
      included.add(imp);
      if (!add({ path: imp, startLine: 1, endLine: lineCount(text), reason: 'import' }, text)) break;
    }
  }

  return { snippets, totalChars: total, truncated, unresolved };
}

/** Nearest directory (from the file up to the root) containing a manifest; '' for the root. */
function findManifestDir(root: string, file: string): string {
  let dir = posix.dirname(file);
  while (dir && dir !== '.') {
    if (MANIFESTS.some((m) => readText(root, `${dir}/${m}`) !== undefined)) return dir;
    const up = posix.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return '';
}

/** Renders the context for an LLM prompt: one fenced block per snippet with line numbers. */
export function formatContext(ctx: CodeContext): string {
  const parts = ctx.snippets.map((s) => {
    const body = s.content
      .split('\n')
      .map((l, i) => {
        const n = s.startLine + i;
        return `${n === s.focusLine ? '>' : ' '}${String(n).padStart(5)} | ${l}`;
      })
      .join('\n');
    return `--- ${s.path}:${s.startLine}-${s.endLine} (${s.reason})\n${body}`;
  });
  if (ctx.truncated) parts.push('--- [truncated]');
  return parts.join('\n\n');
}
