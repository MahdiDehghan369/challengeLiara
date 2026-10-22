import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { fa } from '../../ui/cli/i18n/fa.js';

export const ACTION_TYPES = [
  'set_env',
  'resize_app',
  'restart_app',
  'rollback_app',
  'redeploy_app',
  'code_patch',
  'config_file',
  'run_in_container',
  'set_read_only',
  'create_disk',
  'manual',
] as const;
export const CATEGORIES = ['code', 'config', 'resource', 'dependency', 'platform', 'network'] as const;
export const KNOWLEDGE_PLATFORMS = ['node', 'next', 'python', 'django', 'laravel', 'docker'] as const;

const ParamValue = z.union([z.string(), z.number(), z.boolean()]);

export const FixSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  descriptionFa: z.string().min(1),
  params: z.record(z.string(), ParamValue).optional(),
});

export const PatternSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    regex: z.string().min(1),
    flags: z.string().regex(/^[imsu]*$/).optional(),
    category: z.enum(CATEGORIES),
    platforms: z.array(z.enum(KNOWLEDGE_PLATFORMS)).min(1),
    titleFa: z.string().min(1),
    likelyCauseFa: z.string().min(1),
    fixes: z.array(FixSchema).min(1),
    /** A log line the regex must match; enforced by tests. */
    sample: z.string().min(1),
  })
  .superRefine((p, ctx) => {
    try {
      new RegExp(p.regex, p.flags);
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['regex'], message: `invalid regex: ${(e as Error).message}` });
    }
  });

export const KnowledgeFileSchema = z
  .object({
    version: z.literal(1),
    patterns: z.array(PatternSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.patterns.forEach((p, i) => {
      if (seen.has(p.id)) ctx.addIssue({ code: 'custom', path: ['patterns', i, 'id'], message: `duplicate id ${p.id}` });
      seen.add(p.id);
    });
  });

export type KnowledgeFix = z.infer<typeof FixSchema>;
export type KnowledgePattern = z.infer<typeof PatternSchema>;
export type ActionType = (typeof ACTION_TYPES)[number];
export type KnowledgeCategory = (typeof CATEGORIES)[number];

export interface CompiledPattern extends KnowledgePattern {
  re: RegExp;
}

export interface KnowledgeMatch {
  pattern: CompiledPattern;
  /** The matched substring. */
  match: string;
  /** Capture groups (index 1..n); undefined for groups that did not participate. */
  groups: (string | undefined)[];
  /** likelyCauseFa / fixes with `{n}` placeholders filled from the capture groups. */
  likelyCauseFa: string;
  fixes: KnowledgeFix[];
}

export function parseKnowledge(text: string): CompiledPattern[] {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    throw new ValidationError('patterns.yaml is not valid YAML', { messageFa: fa.knowledge.invalid, cause });
  }
  const parsed = KnowledgeFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid patterns.yaml', {
      messageFa: fa.knowledge.invalid,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  return parsed.data.patterns.map((p) => ({ ...p, re: new RegExp(p.regex, p.flags) }));
}

/** Next to this module in src (tsx/vitest); `build` copies it next to the compiled module in dist. */
export const DEFAULT_PATTERNS_PATH = fileURLToPath(new URL('./patterns.yaml', import.meta.url));

let cached: CompiledPattern[] | undefined;

export function loadKnowledge(path: string = DEFAULT_PATTERNS_PATH): CompiledPattern[] {
  if (path === DEFAULT_PATTERNS_PATH && cached) return cached;
  if (!existsSync(path)) {
    throw new ValidationError(`Knowledge file not found: ${path}`, { messageFa: fa.knowledge.notFound });
  }
  const patterns = parseKnowledge(readFileSync(path, 'utf8'));
  if (path === DEFAULT_PATTERNS_PATH) cached = patterns;
  return patterns;
}

function fill(template: string, groups: (string | undefined)[]): string {
  return template.replace(/\{(\d)\}/g, (_m, n: string) => groups[Number(n) - 1] ?? fa.knowledge.unknownValue);
}

function fillFix(fix: KnowledgeFix, groups: (string | undefined)[]): KnowledgeFix {
  const params = fix.params
    ? Object.fromEntries(Object.entries(fix.params).map(([k, v]) => [k, typeof v === 'string' ? fill(v, groups) : v]))
    : undefined;
  return { ...fix, descriptionFa: fill(fix.descriptionFa, groups), ...(params ? { params } : {}) };
}

export interface MatchOptions {
  patterns?: CompiledPattern[];
  /** Stop after the first match (patterns are ordered most-specific first). */
  first?: boolean;
}

/** Matches log text against the knowledge base. Text is treated as data only. */
export function matchKnowledge(text: string, opts: MatchOptions = {}): KnowledgeMatch[] {
  const patterns = opts.patterns ?? loadKnowledge();
  const out: KnowledgeMatch[] = [];
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const groups = m.slice(1);
    out.push({
      pattern: p,
      match: m[0],
      groups,
      likelyCauseFa: fill(p.likelyCauseFa, groups),
      fixes: p.fixes.map((f) => fillFix(f, groups)),
    });
    if (opts.first) break;
  }
  return out;
}
