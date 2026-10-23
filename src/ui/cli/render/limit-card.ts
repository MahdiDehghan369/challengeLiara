import pc from 'picocolors';
import { limitsByCategory } from '../../../limits/catalog.js';
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

/** `siavash limits`: the whole limits catalog (T10.4), grouped, each item with its alternative. */
export function renderKnownLimits(opts: CardOptions = {}): string {
  const colors = pc.createColors(opts.color ?? pc.isColorSupported);
  const lines = [colors.bold(c.limitsTitle)];
  for (const g of limitsByCategory()) {
    if (!g.items.length) continue;
    lines.push('', colors.bold(colors.yellow(g.titleFa)));
    for (const l of g.items) lines.push(`  • ${l.whatFa}`, colors.dim(`    ${c.limitWhy} ${l.whyFa}`), `    ${colors.green(c.limitAlt)} ${l.alternativeFa}`);
  }
  lines.push('', c.knownNote);
  return lines.join('\n');
}
