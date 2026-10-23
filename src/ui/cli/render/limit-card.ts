import pc from 'picocolors';
import { fa } from '../i18n/fa.js';
import { capLines, type CardOptions } from './findings.js';

/** Limit card (T9.4): what is not possible, why, and the alternative. */

const c = fa.cards;

export interface Limit {
  whatFa: string;
  whyFa?: string;
  alternativesFa: string[];
}

export function renderLimitCard(l: Limit, opts: CardOptions = {}): string {
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  const lines = [
    colors.bold(colors.yellow(c.limitTitle)),
    `${c.limitWhat} ${l.whatFa}`,
    ...(l.whyFa ? [`${c.limitWhy} ${l.whyFa}`] : []),
    ...(l.alternativesFa.length ? [c.limitAlt, ...l.alternativesFa.map((a) => `  • ${a}`)] : []),
  ];
  return capLines(lines, opts).join('\n');
}

/** `siavash limits`: the known limits in Persian. TODO(T10.4): the full limits catalog. */
export function renderKnownLimits(opts: CardOptions = {}): string {
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  return capLines(
    [colors.bold(c.limitsTitle), c.humanOnly, ...c.knownHumanOnly.map((x) => `  • ${x}`), c.agentLimits, ...c.knownAgent.map((x) => `  • ${x}`), '', c.knownNote],
    opts,
  ).join('\n');
}
