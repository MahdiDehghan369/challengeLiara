import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { loadPrompt } from '../llm/prompts/index.js';
import { askStructured } from '../llm/structured.js';
import type { LlmClient } from '../llm/types.js';
import { redactText } from '../safety/redact.js';
import { LlmError } from '../shared/errors.js';
import type { Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { analyzeBuildLog, type LogAnalysis } from './log-analyzer.js';

/**
 * Build failure analysis (T8.13): build-specific log patterns + project-aware rules (e.g. `start` runs
 * `dist/` but nothing builds it) + the T8.3 log analyzer; the LLM only when nothing deterministic
 * matched. File fixes (package.json script / engines, .npmrc) are shown as a diff, applied after
 * confirmation and followed by a redeploy (which asks its own approval).
 */

export type BuildCauseId = 'missing-build-script' | 'node-version' | 'typescript-error' | 'peer-deps' | 'lockfile' | 'dockerfile' | 'build-oom' | 'unknown';

export type BuildFix =
  | { type: 'package-script'; name: string; command: string; descriptionFa: string }
  | { type: 'engines'; node: string; descriptionFa: string }
  | { type: 'npmrc'; line: string; descriptionFa: string }
  | { type: 'code_patch'; descriptionFa: string }
  | { type: 'manual'; descriptionFa: string };

export interface BuildDiagnosis {
  cause: BuildCauseId;
  causeFa: string;
  explanationFa?: string;
  fix: BuildFix;
  confidence: number;
  evidence: string[];
  source: 'rules' | 'project' | 'llm' | 'none';
  logs: LogAnalysis;
}

const PATTERNS: Array<{ id: BuildCauseId; re: RegExp }> = [
  { id: 'missing-build-script', re: /Missing script:? "?build"?|missing script: build/i },
  { id: 'node-version', re: /engine "node" is incompatible|Unsupported engine|requires a peer of node|The engine "node"|node: --[\w-]+ is not allowed|SyntaxError: Unexpected token '\?\?'/i },
  { id: 'typescript-error', re: /error TS\d{4}:/ },
  { id: 'peer-deps', re: /ERESOLVE|npm ERR! peer|Could not resolve dependency/i },
  { id: 'lockfile', re: /can only install packages when your package\.json and package-lock\.json|lock ?file.*(out of sync|not up to date)|ERR_PNPM_OUTDATED_LOCKFILE/i },
  { id: 'dockerfile', re: /failed to solve|Dockerfile parse error|COPY failed|unknown instruction|failed to compute cache key/i },
  { id: 'build-oom', re: /JavaScript heap out of memory|exit code 137|\bKilled\b/i },
];

interface Pkg {
  scripts?: Record<string, string>;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPkg(projectPath: string | undefined): Pkg | undefined {
  if (!projectPath || !existsSync(join(projectPath, 'package.json'))) return undefined;
  try {
    return JSON.parse(readFileSync(join(projectPath, 'package.json'), 'utf8')) as Pkg;
  } catch {
    return undefined;
  }
}

/** The build command a project needs, if we can tell from its files. */
function buildCommand(projectPath: string | undefined, pkg: Pkg | undefined): string | undefined {
  if (!projectPath || !pkg) return undefined;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (existsSync(join(projectPath, 'tsconfig.json')) && deps.typescript) return 'tsc';
  if (deps.next) return 'next build';
  if (deps.vite) return 'vite build';
  return undefined;
}

function fixFor(cause: BuildCauseId, projectPath: string | undefined, pkg: Pkg | undefined): BuildFix {
  const f = fa.buildDoctor.fix;
  switch (cause) {
    case 'missing-build-script': {
      const cmd = buildCommand(projectPath, pkg);
      return cmd ? { type: 'package-script', name: 'build', command: cmd, descriptionFa: f.addScript('build', cmd) } : { type: 'manual', descriptionFa: f.manual };
    }
    case 'node-version':
      return { type: 'engines', node: '>=20', descriptionFa: f.engines('>=20') };
    case 'peer-deps':
      return { type: 'npmrc', line: 'legacy-peer-deps=true', descriptionFa: f.npmrc };
    case 'typescript-error':
      return { type: 'code_patch', descriptionFa: f.codePatch };
    case 'lockfile':
      return { type: 'manual', descriptionFa: f.lockfile };
    case 'dockerfile':
      return { type: 'manual', descriptionFa: f.dockerfile };
    case 'build-oom':
      return { type: 'manual', descriptionFa: f.buildOom };
    default:
      return { type: 'manual', descriptionFa: f.manual };
  }
}

const LlmBuildSchema = z.object({
  failedStep: z.string().default('unknown'),
  causeFa: z.string().min(1),
  fix: z.object({ actionType: z.string(), descriptionFa: z.string().min(1), file: z.string().optional() }),
  confidence: z.number().min(0).max(1).default(0.4),
});

export async function analyzeBuildFailure(
  lines: string[],
  opts: { projectPath?: string; llm?: LlmClient; app?: string; signal?: AbortSignal } = {},
): Promise<BuildDiagnosis> {
  const b = fa.buildDoctor;
  const logs = await analyzeBuildLog(lines);
  const pkg = readPkg(opts.projectPath);
  const make = (cause: BuildCauseId, source: BuildDiagnosis['source'], confidence: number, evidence: string[], explanationFa?: string): BuildDiagnosis => ({
    cause,
    causeFa: b.cause[cause] ?? cause,
    ...(explanationFa ? { explanationFa } : {}),
    fix: fixFor(cause, opts.projectPath, pkg),
    confidence,
    evidence,
    source,
    logs,
  });

  // 1) build-specific log patterns
  for (const p of PATTERNS) {
    const hits = lines.filter((l) => p.re.test(l));
    if (hits.length) return make(p.id, 'rules', 0.85, hits.slice(0, 3).map((l) => redactText(l)));
  }

  // 2) project-aware: start runs compiled output that no script builds
  const start = pkg?.scripts?.start ?? '';
  if (pkg && !pkg.scripts?.build && /\b(dist|build|out)\//.test(start) && buildCommand(opts.projectPath, pkg)) {
    const ev = lines.filter((l) => /build|dist|Cannot find module/i.test(l)).slice(0, 3);
    return make('missing-build-script', 'project', 0.8, [`package.json scripts.start: ${start}`, ...ev.map((l) => redactText(l))], b.explain['missing-build-script'](start));
  }

  // 3) LLM, only when nothing deterministic matched
  if (opts.llm) {
    try {
      const res = await askStructured(opts.llm, {
        role: 'reasoning',
        prompt: loadPrompt('build-failure', { app: opts.app }),
        data: [
          { label: 'build-log', text: redactText(lines.slice(-80).join('\n')) },
          ...(pkg ? [{ label: 'package.json', text: redactText(JSON.stringify(pkg, null, 2)).slice(0, 4000) }] : []),
        ],
        schema: LlmBuildSchema,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      return {
        cause: 'unknown',
        causeFa: res.value.causeFa,
        fix: { type: res.value.fix.actionType === 'code_patch' ? 'code_patch' : 'manual', descriptionFa: res.value.fix.descriptionFa },
        confidence: Math.min(res.value.confidence, 0.6),
        evidence: [],
        source: 'llm',
        logs,
      };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
    }
  }
  return make('unknown', 'none', 0.2, lines.slice(-3).map((l) => redactText(l)));
}

/** File changes for a fix, as before/after text per file (nothing written). */
export function buildFixChanges(projectPath: string, fix: BuildFix): Array<{ file: string; before: string; after: string }> {
  if (fix.type === 'package-script' || fix.type === 'engines') {
    const file = join(projectPath, 'package.json');
    const before = readFileSync(file, 'utf8');
    const pkg = JSON.parse(before) as Pkg & Record<string, unknown>;
    if (fix.type === 'package-script') pkg.scripts = { ...pkg.scripts, [fix.name]: fix.command };
    else pkg.engines = { ...pkg.engines, node: fix.node };
    const indent = /^\s+(?=")/m.exec(before)?.[0] ?? '  ';
    return [{ file: 'package.json', before, after: `${JSON.stringify(pkg, null, indent)}\n` }];
  }
  if (fix.type === 'npmrc') {
    const file = join(projectPath, '.npmrc');
    const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (before.split(/\r?\n/).includes(fix.line)) return [];
    return [{ file: '.npmrc', before, after: `${before}${before && !before.endsWith('\n') ? '\n' : ''}${fix.line}\n` }];
  }
  return [];
}

export interface BuildDoctorResult {
  diagnosis: BuildDiagnosis;
  diff?: string;
  applied: boolean;
  redeploy?: { status: string; messageFa?: string };
}

export interface BuildDoctorDeps {
  ui: Prompter;
  llm?: LlmClient;
  yes?: boolean;
  /** Redeploy after the fix (its own deploy card applies). */
  redeploy?: () => Promise<{ status: string; messageFa?: string }>;
}

export async function runBuildDoctor(input: { lines: string[]; projectPath: string; app: string }, deps: BuildDoctorDeps): Promise<BuildDoctorResult> {
  const b = fa.buildDoctor;
  const diagnosis = await analyzeBuildFailure(input.lines, { projectPath: input.projectPath, app: input.app, ...(deps.llm ? { llm: deps.llm } : {}) });
  deps.ui.note([diagnosis.causeFa, diagnosis.explanationFa, diagnosis.fix.descriptionFa].filter(Boolean).join('\n'), b.findingsTitle);

  const changes = buildFixChanges(input.projectPath, diagnosis.fix);
  if (changes.length === 0) return { diagnosis, applied: false };
  const diff = changes.map((c) => createTwoFilesPatch(c.file, c.file, c.before, c.after, '', '', { context: 3 })).join('\n');
  deps.ui.note(diff, b.diffTitle);
  const ok = deps.yes
    ? 'apply'
    : await deps.ui.select(b.applyQuestion, [
        { value: 'apply', label: b.apply },
        { value: 'skip', label: b.skip },
      ]);
  if (ok !== 'apply') return { diagnosis, diff, applied: false };
  for (const c of changes) writeFileSync(join(input.projectPath, c.file), c.after, 'utf8');
  deps.ui.note(b.applied, b.title);
  const redeploy = deps.redeploy ? await deps.redeploy() : undefined;
  return { diagnosis, diff, applied: true, ...(redeploy ? { redeploy } : {}) };
}
