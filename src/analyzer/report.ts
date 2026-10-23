import { statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { askStructured } from '../llm/structured.js';
import { loadPrompt } from '../llm/prompts/index.js';
import type { LlmClient } from '../llm/types.js';
import { redactText } from '../safety/redact.js';
import { LlmError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { detectDeps, type DepsDetection } from './detect-deps.js';
import { detectEnv, type EnvVarFinding } from './detect-env.js';
import { detectPlatform, type PlatformDetection } from './detect-platform.js';
import { detectPort, type PortDetection } from './detect-port.js';
import { detectScripts, type ScriptsDetection } from './detect-scripts.js';
import { listFiles, readPackageJson, readText } from './project-files.js';
import type { AnalyzerWarning } from './types.js';

/**
 * Project analysis report (T4.5): the deterministic detectors (T4.1–T4.4) plus an optional LLM pass
 * that may only add info-level findings, up to 3 questions and a Persian summary. Deterministic
 * results always win: the LLM can never change platform/port/scripts/env or add blockers.
 */

export type Readiness = 'ready' | 'needs-input' | 'blocked';

export interface ProjectReport {
  path: string;
  platform: PlatformDetection;
  port: PortDetection;
  scripts: ScriptsDetection;
  /** Env var findings (names and metadata only; never values from the user's `.env`). */
  env: EnvVarFinding[];
  /** Required env vars the user still has to provide (DB URLs the agent provisions are excluded). */
  missingEnv: string[];
  deps: DepsDetection;
  warnings: AnalyzerWarning[];
  questions: string[];
  size: { files: number; mb: number };
  readiness: Readiness;
  blockers: AnalyzerWarning[];
  summaryFa?: string;
  llm: { used: boolean; model?: string; errorFa?: string };
}

export interface AnalyzeOptions {
  useLlm?: boolean;
  llm?: LlmClient;
  signal?: AbortSignal;
}

export const LLM_INPUT_BUDGET = 12_000;
const PER_FILE_MAX = 4_000;
const MAX_QUESTIONS = 3;
const MAX_LLM_FINDINGS = 5;

const LlmAnalysisSchema = z.object({
  missed: z
    .array(z.object({ code: z.string(), detailFa: z.string().min(1) }))
    .default([]),
  questions: z.array(z.string().min(1)).default([]),
  summaryFa: z.string().default(''),
});

function projectSize(root: string): { files: number; mb: number } {
  const files = listFiles(root, { max: 20_000 });
  let bytes = 0;
  for (const f of files) {
    try {
      bytes += statSync(join(root, f)).size;
    } catch {
      // vanished while scanning
    }
  }
  return { files: files.length, mb: Math.round((bytes / (1024 * 1024)) * 100) / 100 };
}

function platformWarnings(platform: PlatformDetection): AnalyzerWarning[] {
  if (platform.platform === 'unknown') {
    return [{ code: 'UNKNOWN_PLATFORM', severity: 'blocker', messageFa: fa.report.unknownPlatform, fixFa: fa.report.unknownPlatformFix }];
  }
  if (platform.liaraPlatformId === undefined) {
    // TODO(OQ-20): drop once the Liara platform ids are recorded.
    const w: AnalyzerWarning = {
      code: 'PLATFORM_UNVERIFIED',
      severity: 'warning',
      messageFa: fa.report.platformUnverified(platform.platform),
      fixFa: fa.report.platformUnverifiedFix,
    };
    if (platform.evidence.length > 0) w.evidence = platform.evidence.join(', ');
    return [w];
  }
  return [];
}

function missingEnvWarnings(missing: string[]): AnalyzerWarning[] {
  if (missing.length === 0) return [];
  return [{ code: 'MISSING_ENV', severity: 'warning', messageFa: fa.report.missingEnv(missing.join(', ')), fixFa: fa.report.missingEnvFix }];
}

/** Files the LLM may see, most informative first. `.env` is never included. */
function keyFiles(root: string, scripts: ScriptsDetection): string[] {
  const candidates = [
    'package.json',
    'Dockerfile',
    'requirements.txt',
    'pyproject.toml',
    'composer.json',
    'go.mod',
    '.env.example',
    'prisma/schema.prisma',
  ];
  const pkg = readPackageJson(root);
  if (pkg?.main) candidates.push(pkg.main);
  const fromStart = scripts.start ? /\b([\w./-]+\.(?:m?js|ts|py))\b/.exec(scripts.start)?.[1] : undefined;
  if (fromStart) candidates.push(fromStart);
  candidates.push('index.js', 'server.js', 'app.js', 'src/index.ts', 'src/main.ts', 'src/server.ts', 'main.py', 'app.py', 'manage.py', 'main.go');
  return [...new Set(candidates.map((c) => c.replace(/^\.\//, '')))].filter((c) => c !== '.env' && readText(root, c) !== undefined);
}

function llmData(root: string, files: string[]): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  let left = LLM_INPUT_BUDGET;
  for (const f of files) {
    if (left <= 200) break;
    const text = redactText(readText(root, f) ?? '').slice(0, Math.min(PER_FILE_MAX, left));
    out.push({ label: f, text });
    left -= text.length;
  }
  return out;
}

function llmCode(code: string): string {
  const c = code.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{1,40}$/.test(c) ? c : 'LLM_FINDING';
}

export async function analyzeProject(path: string, opts: AnalyzeOptions = {}): Promise<ProjectReport> {
  const platform = detectPlatform(path);
  const port = detectPort(path, platform.platform);
  const scripts = detectScripts(path, platform.platform);
  const envDet = detectEnv(path);
  const deps = detectDeps(path, envDet.vars.map((v) => v.name));

  const provisioned = new Set(deps.databases.map((d) => d.envName));
  const missingEnv = envDet.vars
    .filter((v) => v.required && !v.managedByAgent && v.suggestedValue === undefined && !provisioned.has(v.name))
    .map((v) => v.name);

  const warnings: AnalyzerWarning[] = [...platformWarnings(platform), ...port.warnings, ...scripts.warnings, ...deps.warnings, ...missingEnvWarnings(missingEnv)];
  const report: ProjectReport = {
    path,
    platform,
    port,
    scripts,
    env: envDet.vars,
    missingEnv,
    deps,
    warnings,
    questions: [],
    size: projectSize(path),
    readiness: 'ready',
    blockers: [],
    llm: { used: false },
  };

  if (opts.useLlm && opts.llm) {
    try {
      const res = await askStructured(opts.llm, {
        role: 'reasoning',
        prompt: loadPrompt('analyze-project', {
          platform: platform.platform,
          port: port.port,
          scripts: [scripts.build && `build=${scripts.build}`, scripts.start && `start=${scripts.start}`].filter(Boolean).join(', '),
        }),
        data: llmData(path, keyFiles(path, scripts)),
        schema: LlmAnalysisSchema,
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const known = new Set(warnings.map((w) => w.code));
      for (const m of res.value.missed.slice(0, MAX_LLM_FINDINGS)) {
        const code = llmCode(m.code);
        if (known.has(code)) continue;
        known.add(code);
        warnings.push({ code, severity: 'info', messageFa: m.detailFa, fixFa: fa.report.llmFindingFix, evidence: 'llm' });
      }
      report.questions = res.value.questions.slice(0, MAX_QUESTIONS);
      if (res.value.summaryFa) report.summaryFa = res.value.summaryFa;
      report.llm = { used: true, model: res.model };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      report.llm = { used: false, errorFa: fa.report.llmUnavailable };
    }
  }

  report.blockers = warnings.filter((w) => w.severity === 'blocker');
  report.readiness =
    report.blockers.length > 0 ? 'blocked' : missingEnv.length > 0 || report.questions.length > 0 ? 'needs-input' : 'ready';
  return report;
}
