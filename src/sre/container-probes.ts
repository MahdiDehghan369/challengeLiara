import type { ConsoleResult } from '../liara/index.js';
import { redactText } from '../safety/redact.js';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { EvidenceItem, Hypothesis, RcaResult } from './rca.js';

/**
 * Container probes (T8.5): a fixed allowlist of read-only commands with strictly validated arguments.
 * There is no way to pass a free-form command: callers choose a check id, the command text is built here.
 * Outputs are redacted (env values are never read: only names) and fed back into the RCA.
 */

export const PROBE_IDS = ['env-names', 'disk', 'memory', 'processes', 'node-version', 'list-dir', 'package-json', 'dns', 'tcp'] as const;
export type ProbeCheckId = (typeof PROBE_IDS)[number];

export interface ProbeCheck {
  id: string;
  args?: { path?: string; host?: string; port?: number };
}

const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const PATH_RE = /^\/?[A-Za-z0-9._/-]{1,200}$/;
const OUTPUT_MAX = 2000;

function bad(id: string): never {
  throw new ValidationError(`invalid args for ${id}`, { messageFa: fa.containerProbes.badArg(id), details: { id } });
}

/** The only place command text is produced. Unknown ids and unsafe arguments are rejected. */
export function buildProbeCommand(check: ProbeCheck): string {
  const a = check.args ?? {};
  switch (check.id as ProbeCheckId) {
    case 'env-names':
      return 'env | cut -d= -f1';
    case 'disk':
      return 'df -h';
    case 'memory':
      return 'free -m';
    case 'processes':
      return 'ps aux --sort=-%mem | head -n 10';
    case 'node-version':
      return 'node -v';
    case 'package-json':
      return 'cat package.json';
    case 'list-dir': {
      const p = a.path ?? '.';
      if (p !== '.' && (!PATH_RE.test(p) || p.split('/').includes('..'))) bad(check.id);
      return `ls -la ${p}`;
    }
    case 'dns':
      if (!a.host || !HOST_RE.test(a.host)) bad(check.id);
      return `getent hosts ${a.host}`;
    case 'tcp':
      if (!a.host || !HOST_RE.test(a.host) || !Number.isInteger(a.port) || (a.port as number) < 1 || (a.port as number) > 65535) bad(check.id);
      return `nc -zv -w 3 ${a.host} ${a.port}`;
    default:
      throw new ValidationError(`probe not allowed: ${check.id}`, { messageFa: fa.containerProbes.notAllowed(check.id), details: { id: check.id } });
  }
}

export interface ProbeCheckResult {
  id: ProbeCheckId;
  command: string;
  ok: boolean;
  exitCode: number | undefined;
  output: string;
  args?: ProbeCheck['args'];
}

export interface ContainerRunner {
  runInContainer(app: string, command: string, opts?: { timeoutMs?: number }): Promise<ConsoleResult>;
}

/** Validates every check first (all-or-nothing), then runs them one by one. */
export async function runContainerChecks(runner: ContainerRunner, app: string, checks: ProbeCheck[], opts: { timeoutMs?: number } = {}): Promise<ProbeCheckResult[]> {
  const commands = checks.map((c) => buildProbeCommand(c));
  const out: ProbeCheckResult[] = [];
  for (const [i, check] of checks.entries()) {
    const command = commands[i] as string;
    const r = await runner.runInContainer(app, command, { timeoutMs: opts.timeoutMs ?? 20_000 });
    let output = redactText(r.stdout);
    // names only, even if the shell ignored the pipe
    if (check.id === 'env-names') output = output.split('\n').map((l) => l.split('=')[0]).join('\n');
    out.push({
      id: check.id as ProbeCheckId,
      command,
      ok: r.exitCode === 0 && !r.timedOut,
      exitCode: r.exitCode,
      output: output.slice(0, OUTPUT_MAX),
      ...(check.args ? { args: check.args } : {}),
    });
  }
  return out;
}

/**
 * Feeds probe results back into the RCA: adds them to the evidence catalog and moves confidence.
 * - env-names without the variable a set_env hypothesis names → +0.15; with it → −0.3.
 * - tcp/dns failing → db/network config hypotheses +0.15; succeeding → −0.2.
 */
export function applyProbeResults(rca: RcaResult, results: ProbeCheckResult[]): RcaResult {
  const catalog: EvidenceItem[] = [...rca.catalog];
  const hypotheses: Hypothesis[] = rca.hypotheses.map((h) => ({ ...h, evidence: [...h.evidence] }));
  const clamp = (n: number) => Math.max(0, Math.min(0.95, Math.round(n * 100) / 100));
  results.forEach((r, i) => {
    const ref = `container:${i + 1}`;
    const text = `$ ${r.command} (exit ${String(r.exitCode)})\n${r.output}`;
    catalog.push({ ref, type: 'probe', text });
    for (const h of hypotheses) {
      const fix = h.proposedFixes[0];
      if (r.id === 'env-names' && fix?.actionType === 'set_env' && typeof fix.params?.name === 'string') {
        const present = r.output.split('\n').map((x) => x.trim()).includes(fix.params.name);
        h.confidence = clamp(h.confidence + (present ? -0.3 : 0.15));
        h.evidence.push({ type: 'probe', ref, quote: `$ ${r.command}` });
      }
      if ((r.id === 'tcp' || r.id === 'dns') && (h.category === 'config' || h.category === 'network') && fix?.actionType === 'set_env') {
        h.confidence = clamp(h.confidence + (r.ok ? -0.2 : 0.15));
        h.evidence.push({ type: 'probe', ref, quote: `$ ${r.command}` });
      }
    }
  });
  hypotheses.sort((a, b) => b.confidence - a.confidence);
  return { ...rca, catalog, hypotheses: hypotheses.map((h, i) => ({ ...h, id: `h${i + 1}` })) };
}
