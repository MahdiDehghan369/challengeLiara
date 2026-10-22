import { relTimeFa, toFaDigits } from '../../shared/time.js';
import { fa } from './i18n/fa.js';

/**
 * Display formatters for the Persian CLI. Numbers use Persian digits and separators; nothing here
 * adds colour, so outputs are stable in tests and when piped.
 */

export interface NumberFormatOptions {
  /** 'fa' (default) → Persian digits and separators; 'en' → ASCII digits with commas. */
  digits?: 'fa' | 'en';
}

function groupThousands(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Formats a number with thousands separators (and up to `decimals` fraction digits). */
export function formatNumber(n: number, opts: NumberFormatOptions & { decimals?: number } = {}): string {
  if (!Number.isFinite(n)) return String(n);
  const fixed = n.toFixed(opts.decimals ?? 0);
  const [rawInt, frac] = fixed.replace(/^-/, '').split('.');
  const neg = n < 0 && /[1-9]/.test(fixed) ? '-' : '';
  const trimmedFrac = frac?.replace(/0+$/, '');
  if (opts.digits === 'en') {
    return `${neg}${groupThousands(rawInt as string, ',')}${trimmedFrac ? `.${trimmedFrac}` : ''}`;
  }
  const int = groupThousands(rawInt as string, fa.format.thousandsSep);
  return toFaDigits(`${neg}${int}${trimmedFrac ? `${fa.format.decimalSep}${trimmedFrac}` : ''}`);
}

/** 1250000 → "۱٬۲۵۰٬۰۰۰ تومان". */
export function toman(n: number, opts: NumberFormatOptions = {}): string {
  return `${formatNumber(Math.round(n), opts)} ${fa.format.toman}`;
}

/** Persian relative time ("۵ دقیقه پیش"). */
export function relTime(ts: number | string | Date, now: number = Date.now()): string {
  return relTimeFa(ts, now);
}

/** 1536 → "۱٫۵ کیلوبایت" (base 1024, one decimal above bytes). */
export function bytes(n: number, opts: NumberFormatOptions = {}): string {
  const units = fa.format.byteUnits;
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatNumber(v, { ...opts, decimals: i === 0 ? 0 : 1 })} ${units[i]}`;
}

/** 42 → "████████░░░░░░░░░░░░ ۴۲٪". Clamps to 0..100. */
export function percentBar(pct: number, width = 20, opts: NumberFormatOptions = {}): string {
  const p = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const filled = Math.round((p / 100) * width);
  const label = opts.digits === 'en' ? `${Math.round(p)}%` : `${toFaDigits(Math.round(p))}${fa.format.percent}`;
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${label}`;
}

const SPARKS = '▁▂▃▄▅▆▇█';

/** [1, 5, 9] → "▁▄█". Scales between min and max; non-finite values render as a space. */
export function sparkline(values: readonly number[]): string {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return '';
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min;
  return values
    .map((v) => {
      if (!Number.isFinite(v)) return ' ';
      const idx = span === 0 ? 0 : Math.round(((v - min) / span) * (SPARKS.length - 1));
      return SPARKS[idx];
    })
    .join('');
}

/**
 * Keeps RTL text and LTR fragments (paths, commands, code) on separate lines so terminals do not
 * reorder them: the Persian line first, then each LTR fragment indented on its own line.
 */
export function withLtr(rtl: string, ...ltr: string[]): string {
  return [rtl, ...ltr.filter((s) => s !== '').map((s) => `  ${s}`)].join('\n');
}
