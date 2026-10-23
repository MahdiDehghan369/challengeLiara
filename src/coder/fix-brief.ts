import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execa } from 'execa';
import { listFiles, readText } from '../analyzer/project-files.js';
import { redactText } from '../safety/redact.js';
import type { Incident } from '../sre/incident.js';
import { parseFrames } from '../sre/log-cluster.js';
import type { Hypothesis } from '../sre/rca.js';
import type { Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { mapContainerPath, type CodeContext } from './context.js';
import { renderFixBrief, type FixBriefView } from './templates/fix-brief.js';

/**
 * Fix Brief generator (T8.14): a self-contained Markdown task for the user's own coding agent, built
 * from a code-caused incident (RCA hypothesis + error + optional T8.7 context). Only env names, never
 * values; the rendered text is redacted and any known secret value is scrubbed.
 */

export const MAX_EVIDENCE_LINES = 15;

export interface FixBriefInput {
  incident: Incident;
  hypothesis: Hypothesis;
  /** Error header + stack trace. */
  error: string;
  /** Local project root: maps stack frames to files and reads the scripts for "Reproduce". */
  root?: string;
  context?: CodeContext;
  /** Failing request, e.g. `GET /api/orders/5`. */
  endpoint?: string;
  release?: string;
  envNames?: string[];
  /** Values that must never appear (e.g. env values known to the caller). */
  knownSecrets?: string[];
  port?: number;
}

function location(input: FixBriefInput): FixBriefView['location'] {
  const frames = parseFrames(input.error).filter((f) => f.isUserCode);
  const snippet = input.context?.snippets.find((s) => s.reason === 'frame');
  const local = input.root ? listFiles(input.root) : [];
  for (const f of frames) {
    const file = local.length ? mapContainerPath(f.file, local) : undefined;
    if (file || !local.length) return { file: file ?? f.file, ...(f.line ? { line: f.line } : {}), ...(f.fn ? { fn: f.fn } : {}) };
  }
  return snippet ? { file: snippet.path, ...(snippet.focusLine ? { line: snippet.focusLine } : {}) } : undefined;
}

function scripts(root: string | undefined): Record<string, string> {
  const pkg = root ? readText(root, 'package.json') : undefined;
  try {
    return pkg ? ((JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts ?? {}) : {};
  } catch {
    return {};
  }
}

export function buildFixBrief(input: FixBriefInput): string {
  const errorLines = input.error.split(/\r?\n/).filter((l) => l.trim());
  const header = errorLines[0] ?? input.hypothesis.titleFa;
  const port = input.port ?? 3000;
  const path = input.endpoint?.split(' ').pop();
  const s = scripts(input.root);
  const loc = location(input);

  const reproduce = [
    ...(s.start ? [`PORT=${port} npm start`] : ['# start the app the way it runs in production']),
    ...(path ? [`curl -i http://localhost:${port}${path}`] : []),
    ...(s.test ? ['npm test'] : []),
  ];
  const acceptance = [
    ...(path ? [`\`curl -i http://localhost:${port}${path}\` returns HTTP 200 (not 500)`] : [`The error \`${header}\` no longer occurs`]),
    ...(s.test ? ['`npm test` passes'] : []),
    'A new regression test covers this exact case',
    `\`GET /health\` (or \`/\`) still returns 200 (smoke test)`,
  ];
  const view: FixBriefView = {
    incidentId: input.incident.id,
    app: input.incident.app,
    summaryFa: fa.fixBrief.summary(input.hypothesis.titleFa, loc ? `${loc.file}${loc.line ? `:${loc.line}` : ''}` : fa.fixBrief.unknownLocation, Math.round(input.hypothesis.confidence * 100)),
    problem: `The app throws \`${header}\`${input.endpoint ? ` while serving \`${input.endpoint}\`` : ''}.`,
    impact: input.endpoint ? `requests to ${input.endpoint} fail with an error instead of a valid response.` : 'the affected feature fails for users.',
    evidence: errorLines.slice(0, MAX_EVIDENCE_LINES),
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    startedAt: input.incident.openedAt,
    ...(input.release ? { release: input.release } : {}),
    ...(loc ? { location: loc } : {}),
    cause: [input.hypothesis.titleFa, input.hypothesis.explanationFa].filter(Boolean).join(' — '),
    confidencePct: Math.round(input.hypothesis.confidence * 100),
    reproduce,
    acceptance,
    envNames: input.envNames ?? [],
  };
  let md = redactText(renderFixBrief(view));
  for (const secret of input.knownSecrets ?? []) if (secret.length >= 4) md = md.split(secret).join('***');
  return md;
}

/** Writes `.siavash/fix-briefs/<incident-id>.md` and returns its path. */
export function writeFixBrief(root: string, incidentId: string, markdown: string): string {
  const dir = join(root, '.siavash', 'fix-briefs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${incidentId.replace(/[^\w.-]/g, '-')}.md`);
  writeFileSync(file, markdown, 'utf8');
  return file;
}

const CLIPBOARD: Partial<Record<NodeJS.Platform, Array<[string, string[]]>>> = {
  win32: [['clip', []]],
  darwin: [['pbcopy', []]],
  linux: [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ],
};

/** Copies to the OS clipboard with the platform tool; false when none works (caller prints instead). */
export async function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform, run = execa): Promise<boolean> {
  for (const [cmd, args] of CLIPBOARD[platform] ?? []) {
    try {
      await run(cmd, args, { input: text, timeout: 5000 });
      return true;
    } catch {
      // try the next tool
    }
  }
  return false;
}

/** Brief → file + clipboard (or printed when there is no clipboard). Returns the text and the path. */
export async function deliverFixBrief(
  root: string,
  input: FixBriefInput,
  ui: Pick<Prompter, 'note'>,
  opts: { copy?: (text: string) => Promise<boolean> } = {},
): Promise<{ markdown: string; path: string; copied: boolean }> {
  const markdown = buildFixBrief({ root, ...input });
  const path = writeFixBrief(root, input.incident.id, markdown);
  const copied = await (opts.copy ?? copyToClipboard)(markdown);
  ui.note([fa.fixBrief.savedTo(path), copied ? fa.fixBrief.copied : fa.fixBrief.notCopied].join('\n'), fa.fixBrief.title);
  if (!copied) ui.note(markdown, fa.fixBrief.title);
  return { markdown, path, copied };
}
