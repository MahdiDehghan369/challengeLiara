import pc from 'picocolors';
import { riskLabel, Risk } from '../../../safety/risk.js';
import { redactText } from '../../../safety/redact.js';
import type { Signal } from '../../../sre/detectors/types.js';
import type { Hypothesis, RcaResult } from '../../../sre/rca.js';
import type { RemediationOption, RemediationPlan } from '../../../sre/remediate.js';
import { percentBar } from '../format.js';
import { fa } from '../i18n/fa.js';

/**
 * Findings cards (T9.4): hypothesis (title, confidence bar, plain explanation, ≤ 3 short evidence
 * items with time, fixes with a coloured risk label). Cards stay around 25 lines; `verbose` shows all.
 */

export const CARD_MAX_LINES = 25;
const EVIDENCE_MAX = 3;
const QUOTE_MAX = 140;

export interface CardOptions {
  verbose?: boolean;
  color?: boolean;
}

const c = fa.cards;
const colorsOf = (o: CardOptions) => pc.createColors(o.color ?? pc.isColorSupported);

export function riskTag(r: Risk, colors: ReturnType<typeof pc.createColors>): string {
  const label = `[${riskLabel(r)}]`;
  return r >= Risk.R3 ? colors.bold(colors.red(label)) : r === Risk.R2 ? colors.yellow(label) : r === Risk.R1 ? colors.green(label) : colors.dim(label);
}

/** Caps a card at `CARD_MAX_LINES` (unless verbose) with a "more with --verbose" line. */
export function capLines(lines: string[], opts: CardOptions): string[] {
  if (opts.verbose || lines.length <= CARD_MAX_LINES) return lines;
  const keep = lines.slice(0, CARD_MAX_LINES - 1);
  return [...keep, c.more(lines.length - keep.length)];
}

const clip = (s: string, n = QUOTE_MAX) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/** "12:04:31" from an evidence ref like `log:1729…` when the catalog knows a time; otherwise nothing. */
function evidenceTime(ref: string, catalogTs: Map<string, number> | undefined): string {
  const ts = catalogTs?.get(ref);
  return ts ? `${new Date(ts).toISOString().slice(11, 19)} ` : '';
}

export function renderHypothesisCard(
  h: Hypothesis,
  index: number,
  fixes: RemediationOption[],
  opts: CardOptions & { evidenceTimes?: Map<string, number> } = {},
): string {
  const colors = colorsOf(opts);
  const pct = Math.round(h.confidence * 100);
  const evidence = opts.verbose ? h.evidence : h.evidence.slice(0, EVIDENCE_MAX);
  const lines = [
    colors.bold(`${c.hypothesis(index)}: ${h.titleFa}`),
    `${c.confidence} ${percentBar(pct, 20)}`,
    `${c.plain} ${h.explanationFa}`,
    ...(evidence.length ? [c.evidence, ...evidence.map((e) => `  • ${evidenceTime(e.ref, opts.evidenceTimes)}${redactText(clip(e.quote))}`)] : []),
    ...(fixes.length
      ? [
          c.fixes,
          ...fixes.map((f) => `  ${riskTag(f.risk, colors)} ${f.kind === 'quick' ? c.quick : c.root}: ${f.titleFa}${f.needsInput.length ? ` ${c.needs(f.needsInput.join(', '))}` : ''}`),
        ]
      : []),
  ];
  return capLines(lines, opts).join('\n');
}

/** The whole diagnosis: the problem, the top hypothesis as a full card, the others in one line each. */
export function renderFindings(rca: RcaResult, plan: RemediationPlan | undefined, signals: Signal[], opts: CardOptions = {}): string {
  const top = rca.hypotheses[0];
  const problem = signals[0]?.titleFa ?? top?.titleFa;
  const fixesFor = (h: Hypothesis) => (plan ? [plan.quickFix, plan.rootFix].filter((f): f is RemediationOption => !!f && f.hypothesisId === h.id) : []);
  const lines = [
    ...(problem ? [`${c.problem} ${problem}`, ''] : []),
    ...(top ? [renderHypothesisCard(top, 1, fixesFor(top), opts)] : []),
    ...(rca.hypotheses.length > 1
      ? ['', c.otherHypotheses, ...rca.hypotheses.slice(1).map((h, i) => `  ${i + 2}. ${h.titleFa} (${Math.round(h.confidence * 100)}%)`)]
      : []),
  ];
  return capLines(lines.join('\n').split('\n'), opts).join('\n');
}
