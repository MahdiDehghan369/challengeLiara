import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { simpleGit } from 'simple-git';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { checkPatchPath, locateSearch, type Patch } from './patch.js';

/**
 * Applying a patch (T8.9). In a git repo: a `siavash/fix-<incident>` branch from the current HEAD; outside
 * git: copies in `.siavash/backups/<incident>/`. `revertPatch` restores the exact previous state.
 */

export interface AppliedPatch {
  mode: 'git' | 'backup';
  incidentId: string;
  root: string;
  /** Project-relative paths edited / created. */
  edited: string[];
  created: string[];
  diff: string;
  branch?: string;
  baseBranch?: string;
  backupDir?: string;
}

export const fixBranch = (incidentId: string) => `siavash/fix-${incidentId.replace(/[^\w.-]/g, '-')}`;

function replaceOnce(text: string, search: string, replace: string): string {
  const { count, crlf } = locateSearch(text, search);
  if (count !== 1) throw new ValidationError(`search must occur once (found ${count})`, { details: { count } });
  const s = crlf ? search.replace(/\r?\n/g, '\r\n') : search;
  const r = crlf ? replace.replace(/\r?\n/g, '\r\n') : replace;
  const i = text.indexOf(s);
  return text.slice(0, i) + r + text.slice(i + s.length);
}

/** New file contents for every touched file, without writing anything (also used for "show only"). */
export function previewPatch(root: string, patch: Patch): { files: Map<string, { before: string; after: string }>; diff: string } {
  const files = new Map<string, { before: string; after: string }>();
  for (const e of patch.edits) {
    const p = checkPatchPath(root, e.file);
    if (!p.ok) throw new ValidationError(p.problem);
    const cur = files.get(p.rel) ?? { before: readFileSync(p.abs, 'utf8'), after: readFileSync(p.abs, 'utf8') };
    cur.after = replaceOnce(cur.after, e.search, e.replace);
    files.set(p.rel, cur);
  }
  for (const t of patch.testsToAdd) {
    const p = checkPatchPath(root, t.file);
    if (!p.ok) throw new ValidationError(p.problem);
    files.set(p.rel, { before: '', after: t.content });
  }
  const diff = [...files]
    .map(([rel, f]) => createTwoFilesPatch(f.before ? `a/${rel}` : '/dev/null', `b/${rel}`, f.before, f.after, '', '', { context: 3 }))
    .join('\n');
  return { files, diff };
}

export async function applyPatch(root: string, patch: Patch, incidentId: string): Promise<AppliedPatch> {
  const { files, diff } = previewPatch(root, patch);
  const created = patch.testsToAdd.map((t) => (checkPatchPath(root, t.file) as { rel: string }).rel);
  const edited = [...files.keys()].filter((f) => !created.includes(f));
  const isGit = existsSync(join(root, '.git'));
  const applied: AppliedPatch = { mode: isGit ? 'git' : 'backup', incidentId, root, edited, created, diff };

  if (isGit) {
    const git = simpleGit(root);
    // reverting uses `git checkout -- <file>`: never risk the user's own uncommitted work
    const dirty = new Set((await git.status()).files.map((f) => f.path));
    const conflicts = [...edited, ...created].filter((f) => dirty.has(f));
    if (conflicts.length > 0) {
      throw new ValidationError(`uncommitted changes in ${conflicts.join(', ')}`, { messageFa: fa.patch.dirtyFiles(conflicts.join(', ')), details: { files: conflicts } });
    }
    applied.baseBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    applied.branch = fixBranch(incidentId);
    await git.checkoutLocalBranch(applied.branch);
  } else {
    applied.backupDir = join(root, '.siavash', 'backups', incidentId);
    for (const rel of edited) {
      const to = join(applied.backupDir, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(join(root, rel), to);
    }
  }
  for (const [rel, f] of files) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.after, 'utf8');
  }
  return applied;
}

/** Undoes `applyPatch` completely (and an uncommitted or committed fix branch). */
export async function revertPatch(applied: AppliedPatch): Promise<void> {
  const { root } = applied;
  for (const rel of applied.created) rmSync(join(root, rel), { force: true });
  if (applied.mode === 'git') {
    const git = simpleGit(root);
    if (applied.edited.length > 0) await git.checkout(['--', ...applied.edited]).catch(() => undefined);
    await git.checkout(applied.baseBranch as string);
    await git.raw(['branch', '-D', applied.branch as string]).catch(() => undefined);
    // edited files now match the base branch again
    if (applied.edited.length > 0) await git.checkout(['--', ...applied.edited]);
  } else if (applied.backupDir) {
    for (const rel of applied.edited) copyFileSync(join(applied.backupDir, rel), join(root, rel));
    rmSync(applied.backupDir, { recursive: true, force: true });
  }
}

/** Commits the applied patch on its fix branch (git mode); returns the commit hash. */
export async function commitPatch(applied: AppliedPatch, message: string): Promise<string | undefined> {
  if (applied.mode !== 'git') return undefined;
  const git = simpleGit(applied.root);
  await git.add([...applied.edited, ...applied.created]);
  const r = await git.commit(message);
  return r.commit || undefined;
}
