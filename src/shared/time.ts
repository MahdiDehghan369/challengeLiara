import { fa } from '../ui/cli/i18n/fa.js';
import { ValidationError } from './errors.js';

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
  w: 604_800,
};

/** Parses "30s", "5m", "1h", "2d", "1w" or combinations like "1h30m" into seconds. */
export function parseRelative(input: string): number {
  const s = input.replace(/\s+/g, '').toLowerCase();
  if (!/^(\d+[smhdw])+$/.test(s)) {
    throw new ValidationError(`Invalid relative duration: "${input}"`, {
      messageFa: fa.time.invalidDuration,
      details: { input },
    });
  }
  let total = 0;
  for (const m of s.matchAll(/(\d+)([smhdw])/g)) {
    total += Number(m[1]) * (UNIT_SECONDS[m[2] as string] ?? 0);
  }
  return total;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toFaDigits(n: number | string): string {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)] as string);
}

/** Human Persian duration, e.g. 5400 → "۱ ساعت و ۳۰ دقیقه". Shows at most two units. */
export function formatFaDuration(seconds: number): string {
  let rest = Math.max(0, Math.round(seconds));
  const parts: string[] = [];
  const units: Array<[number, string]> = [
    [86_400, fa.time.day],
    [3600, fa.time.hour],
    [60, fa.time.minute],
    [1, fa.time.second],
  ];
  for (const [size, label] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${toFaDigits(n)} ${label}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  if (parts.length === 0) return `${toFaDigits(0)} ${fa.time.second}`;
  return parts.join(fa.time.and);
}
