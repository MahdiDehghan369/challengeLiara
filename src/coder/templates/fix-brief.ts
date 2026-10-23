/**
 * Fix Brief Markdown (T8.14). Section headings and instructions are English on purpose: coding agents
 * follow precise English best. Only the summary at the top is Persian (passed in from fa.ts).
 */

export interface FixBriefView {
  incidentId: string;
  app: string;
  summaryFa: string;
  problem: string;
  impact: string;
  evidence: string[];
  endpoint?: string;
  startedAt?: string;
  release?: string;
  location?: { file: string; line?: number; fn?: string };
  cause: string;
  confidencePct: number;
  reproduce: string[];
  acceptance: string[];
  envNames: string[];
}

export const FIX_BRIEF_SECTIONS = ['Problem', 'Evidence', 'Suspected location', 'Reproduce locally', 'Acceptance criteria', 'Constraints', 'When done'] as const;

const fence = (lines: string[], lang = '') => ['```' + lang, ...lines, '```'];

export function renderFixBrief(v: FixBriefView): string {
  const loc = v.location;
  const out: string[] = [
    `# Fix Brief — ${v.app} (incident ${v.incidentId})`,
    '',
    ...v.summaryFa.split('\n').map((l) => `> ${l}`),
    '',
    `## 1. ${FIX_BRIEF_SECTIONS[0]}`,
    '',
    v.problem,
    '',
    `Impact on end users: ${v.impact}`,
    '',
    `## 2. ${FIX_BRIEF_SECTIONS[1]}`,
    '',
    ...(v.endpoint ? [`- Failing endpoint: \`${v.endpoint}\``] : []),
    ...(v.startedAt ? [`- Started at: ${v.startedAt}`] : []),
    ...(v.release ? [`- Related release: ${v.release}`] : []),
    '',
    ...fence(v.evidence, 'text'),
    '',
    `## 3. ${FIX_BRIEF_SECTIONS[2]}`,
    '',
    loc ? `- File: \`${loc.file}\`${loc.line ? `, line ${loc.line}` : ''}${loc.fn ? `, function \`${loc.fn}\`` : ''}` : '- File: unknown (no stack frame in project code); start from the endpoint handler.',
    `- Probable cause (${v.confidencePct}% confidence): ${v.cause}`,
    '',
    `## 4. ${FIX_BRIEF_SECTIONS[3]}`,
    '',
    ...fence(v.reproduce, 'sh'),
    '',
    `## 5. ${FIX_BRIEF_SECTIONS[4]}`,
    '',
    ...v.acceptance.map((a) => `- [ ] ${a}`),
    '',
    `## 6. ${FIX_BRIEF_SECTIONS[5]}`,
    '',
    '- Fix only this bug; no refactors or unrelated changes.',
    '- Do not touch environment variables, `liara.json`, lockfiles or deploy settings.',
    '- Add a test that fails before the fix and passes after it.',
    ...(v.envNames.length ? [`- The app reads these env vars (names only, values are not part of this brief): ${v.envNames.map((n) => `\`${n}\``).join(', ')}`] : []),
    '',
    `## 7. ${FIX_BRIEF_SECTIONS[6]}`,
    '',
    `Commit with message \`fix: <short description> (siavash incident ${v.incidentId})\` and call \`report_fix_done({ incidentId: "${v.incidentId}" })\` if connected via MCP, or just tell the user.`,
    '',
  ];
  return out.join('\n');
}
