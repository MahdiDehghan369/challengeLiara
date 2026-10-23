import { percentBar } from '../format.js';

/** Upload / long-step progress (T9.3): the percent in a step note becomes a bar. */

// Persian digits U+06F0..U+06F9 and the Persian percent sign U+066A, by code point (no Persian literals in src/)
const FA_ZERO = 0x06f0;
const FA_PERCENT = String.fromCharCode(0x066a);
const PERCENT_RE = new RegExp(`(\\d{1,3})\\s*[%${FA_PERCENT}]`);

/** Finds "37%" (also with Persian digits / percent sign) in a note; undefined when there is none. */
export function percentIn(note: string | undefined): number | undefined {
  if (!note) return undefined;
  const ascii = [...note].map((ch) => {
    const d = ch.charCodeAt(0) - FA_ZERO;
    return d >= 0 && d <= 9 ? String(d) : ch;
  }).join('');
  const m = PERCENT_RE.exec(ascii);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n <= 100 ? n : undefined;
}

/** `████░░░░ 40%` (Persian digits) for the note's percent, or undefined. */
export function progressLine(note: string | undefined, width = 20): string | undefined {
  const pct = percentIn(note);
  return pct === undefined ? undefined : percentBar(pct, width);
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
