import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { redactText } from '../safety/redact.js';

/**
 * Local validation of a patch (T8.9): build, tests and type checks the project already defines, each
 * with a timeout. Outputs are redacted and only the tail is kept.
 */

export interface ValidationCommand {
  name: 'build' | 'test' | 'typecheck' | 'py_compile';
  file: string;
  args: string[];
}

export interface ValidationStepResult {
  name: ValidationCommand['name'];
  command: string;
  ok: boolean;
  exitCode: number | undefined;
  timedOut: boolean;
  outputTail: string;
}

export interface ValidationResult {
  ok: boolean;
  /** No command could be detected: nothing was validated. */
  skipped: boolean;
  steps: ValidationStepResult[];
}

const TAIL_CHARS = 3000;

export function detectValidationCommands(root: string, changedFiles: string[] = []): ValidationCommand[] {
  const out: ValidationCommand[] = [];
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg;
    } catch {
      // invalid package.json: nothing to run from it
    }
    if (pkg.scripts?.build) out.push({ name: 'build', file: 'npm', args: ['run', 'build'] });
    // the default "no test specified" script always fails; skip it
    if (pkg.scripts?.test && !/no test specified/.test(pkg.scripts.test)) out.push({ name: 'test', file: 'npm', args: ['test'] });
    const hasTs = !!(pkg.dependencies?.typescript ?? pkg.devDependencies?.typescript);
    if (hasTs && existsSync(join(root, 'tsconfig.json')) && !pkg.scripts?.build?.includes('tsc')) out.push({ name: 'typecheck', file: 'npx', args: ['tsc', '--noEmit'] });
  }
  const py = changedFiles.filter((f) => f.endsWith('.py'));
  if (py.length > 0) out.push({ name: 'py_compile', file: 'python', args: ['-m', 'py_compile', ...py] });
  return out;
}

export interface RunValidationOptions {
  commands?: ValidationCommand[];
  changedFiles?: string[];
  timeoutMs?: number;
}

export async function runValidation(root: string, opts: RunValidationOptions = {}): Promise<ValidationResult> {
  const commands = opts.commands ?? detectValidationCommands(root, opts.changedFiles);
  if (commands.length === 0) return { ok: true, skipped: true, steps: [] };
  const steps: ValidationStepResult[] = [];
  for (const c of commands) {
    const r = await execa(c.file, c.args, { cwd: root, reject: false, all: true, timeout: opts.timeoutMs ?? 120_000, env: { CI: '1' } });
    const output = redactText(String(r.all ?? ''));
    steps.push({
      name: c.name,
      command: [c.file, ...c.args].join(' '),
      ok: r.exitCode === 0 && !r.timedOut,
      exitCode: r.exitCode,
      timedOut: !!r.timedOut,
      outputTail: output.slice(-TAIL_CHARS),
    });
    // a failing build makes the tests meaningless
    if (c.name === 'build' && !(r.exitCode === 0 && !r.timedOut)) break;
  }
  return { ok: steps.every((s) => s.ok), skipped: false, steps };
}
