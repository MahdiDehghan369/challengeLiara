import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ValidationError } from '../../shared/errors.js';
import { fa } from '../../ui/cli/i18n/fa.js';

/** Prompt templates live next to this file as `<name>.md`; `build` copies them to dist (T3.6/T3.8). */
export const PROMPT_NAMES = [
  'system.fa',
  'analyze-project',
  'rca',
  'explain-fa',
  'patch',
  'summarize-logs',
  'build-failure',
] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

const cache = new Map<string, string>();

/** Loads a prompt and fills `{{var}}` placeholders. Unknown placeholders are left as `—`. */
export function loadPrompt(name: PromptName, vars: Record<string, string | number | undefined> = {}): string {
  let tpl = cache.get(name);
  if (tpl === undefined) {
    const p = fileURLToPath(new URL(`./${name}.md`, import.meta.url));
    if (!existsSync(p)) throw new ValidationError(`prompt not found: ${name}`, { messageFa: fa.llm.promptNotFound(name) });
    tpl = readFileSync(p, 'utf8');
    cache.set(name, tpl);
  }
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k];
    return v === undefined || v === '' ? '—' : String(v);
  });
}
