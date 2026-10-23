import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { loadPrompt } from '../llm/prompts/index.js';
import { askStructured } from '../llm/structured.js';
import type { LlmClient } from '../llm/types.js';
import { redactText } from '../safety/redact.js';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { formatContext, type CodeContext } from './context.js';

/**
 * Patch generation (T8.8): the `code` model returns search/replace edits (not a unified diff). Every edit
 * is validated against the real files: project-relative path, no node_modules/.git/.siavash/.env*, and
 * `search` occurring exactly once. Problems get one correction round; then the patch is rejected.
 */

export interface PatchEdit {
  file: string;
  search: string;
  replace: string;
}

export interface Patch {
  summaryFa: string;
  rootCauseFa: string;
  edits: PatchEdit[];
  testsToAdd: Array<{ file: string; content: string }>;
  riskFa: string;
}

export interface GeneratedPatch extends Patch {
  model: string;
  /** 1 = first answer valid, 2 = valid after the correction round. */
  rounds: number;
}

export const PatchSchema = z.object({
  summaryFa: z.string().min(1),
  rootCauseFa: z.string().min(1),
  edits: z.array(z.object({ file: z.string().min(1), search: z.string(), replace: z.string() })).default([]),
  testsToAdd: z.array(z.object({ file: z.string().min(1), content: z.string().min(1) })).default([]),
  riskFa: z.string().default(''),
});

const DENIED_DIRS = new Set(['node_modules', '.git', '.siavash']);

/** Resolves a project-relative path, or explains why it is not allowed. */
export function checkPatchPath(root: string, file: string): { ok: true; abs: string; rel: string } | { ok: false; problem: string } {
  if (!file || isAbsolute(file) || /^[a-zA-Z]:/.test(file) || file.startsWith('/') || file.startsWith('\\')) {
    return { ok: false, problem: `${file}: absolute paths are not allowed; use a path relative to the project root` };
  }
  const rootAbs = resolve(root);
  const abs = resolve(rootAbs, file);
  const rel = relative(rootAbs, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, problem: `${file}: outside the project root` };
  const parts = rel.split(sep);
  if (parts.some((p) => DENIED_DIRS.has(p))) return { ok: false, problem: `${file}: node_modules, .git and .siavash may not be edited` };
  if ((parts[parts.length - 1] ?? '').startsWith('.env')) return { ok: false, problem: `${file}: .env files may not be edited` };
  return { ok: true, abs, rel: parts.join('/') };
}

function occurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Matches `search` in the file as is, or with LF → CRLF when the file uses CRLF. */
export function locateSearch(text: string, search: string): { count: number; crlf: boolean } {
  const direct = occurrences(text, search);
  if (direct > 0 || !text.includes('\r\n')) return { count: direct, crlf: false };
  return { count: occurrences(text, search.replace(/\r?\n/g, '\r\n')), crlf: true };
}

/** All problems of a patch (empty array = valid). Messages are English: they go back to the model. */
export function validatePatch(root: string, patch: Patch): string[] {
  const problems: string[] = [];
  if (patch.edits.length === 0 && patch.testsToAdd.length === 0) problems.push('the patch has no edits');
  for (const [i, e] of patch.edits.entries()) {
    const p = checkPatchPath(root, e.file);
    if (!p.ok) {
      problems.push(`edit ${i + 1}: ${p.problem}`);
      continue;
    }
    if (!existsSync(p.abs) || !statSync(p.abs).isFile()) {
      problems.push(`edit ${i + 1}: ${e.file} does not exist`);
      continue;
    }
    if (!e.search) {
      problems.push(`edit ${i + 1}: search is empty`);
      continue;
    }
    if (e.search === e.replace) problems.push(`edit ${i + 1}: replace is identical to search`);
    const { count } = locateSearch(readFileSync(p.abs, 'utf8'), e.search);
    if (count !== 1) problems.push(`edit ${i + 1}: search occurs ${count} times in ${e.file} (must be exactly once; copy it exactly, without line numbers)`);
  }
  for (const [i, t] of patch.testsToAdd.entries()) {
    const p = checkPatchPath(root, t.file);
    if (!p.ok) problems.push(`test ${i + 1}: ${p.problem}`);
    else if (existsSync(p.abs)) problems.push(`test ${i + 1}: ${t.file} already exists; tests must be new files`);
  }
  return problems;
}

export interface GeneratePatchInput {
  root: string;
  app?: string;
  /** Error header + stack (redacted again here). */
  error: string;
  context: CodeContext;
  signal?: AbortSignal;
}

export async function generatePatch(llm: LlmClient, input: GeneratePatchInput): Promise<GeneratedPatch> {
  const prompt = loadPrompt('patch', { app: input.app });
  const manifest = existsSync(join(input.root, 'package.json')) ? redactText(readFileSync(join(input.root, 'package.json'), 'utf8')).slice(0, 4000) : '';
  const data = [
    { label: 'error', text: redactText(input.error) },
    { label: 'code', text: formatContext(input.context) },
    ...(manifest ? [{ label: 'package.json', text: manifest }] : []),
  ];
  const ask = (instruction?: string) =>
    askStructured(llm, {
      role: 'code',
      prompt,
      data,
      schema: PatchSchema,
      ...(instruction ? { instruction } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });

  const first = await ask();
  let problems = validatePatch(input.root, first.value);
  if (problems.length === 0) return { ...first.value, model: first.model, rounds: 1 };

  // one correction round with the concrete problems and the previous answer
  const second = await ask(
    [
      'Your previous patch was rejected. Fix these problems and answer with one corrected JSON object:',
      ...problems.map((p) => `- ${p}`),
      'Previous patch:',
      JSON.stringify(first.value).slice(0, 6000),
    ].join('\n'),
  );
  problems = validatePatch(input.root, second.value);
  if (problems.length === 0) return { ...second.value, model: second.model, rounds: 2 };
  throw new ValidationError(`patch invalid after correction: ${problems.join('; ')}`, {
    messageFa: fa.patch.invalid(problems.length),
    details: { problems },
  });
}
