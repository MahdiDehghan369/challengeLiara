import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findStrayPersian } from '../../../scripts/check-fa-strings.js';
import { bytes, formatNumber, percentBar, relTime, sparkline, toman, withLtr } from '../../../src/ui/cli/format.js';

describe('formatters', () => {
  it.each([
    [0, '۰ تومان'],
    [999, '۹۹۹ تومان'],
    [1000, '۱٬۰۰۰ تومان'],
    [1250000, '۱٬۲۵۰٬۰۰۰ تومان'],
    [-45000, '-۴۵٬۰۰۰ تومان'],
    [1234.6, '۱٬۲۳۵ تومان'],
  ])('toman(%d) → %s', (n, out) => {
    expect(toman(n)).toBe(out);
  });

  it('formatNumber: en digits and decimals', () => {
    expect(toman(1250000, { digits: 'en' })).toBe('1,250,000 تومان');
    expect(formatNumber(1234.5, { decimals: 2 })).toBe('۱٬۲۳۴٫۵');
    expect(formatNumber(-0.001, { decimals: 1 })).toBe('۰');
  });

  it('relTime', () => {
    const now = Date.parse('2026-10-20T12:00:00Z');
    expect(relTime(now - 5 * 60_000, now)).toBe('۵ دقیقه پیش');
    expect(relTime(new Date(now + 2 * 3_600_000), now)).toBe('۲ ساعت دیگر');
  });

  it.each([
    [0, '۰ بایت'],
    [512, '۵۱۲ بایت'],
    [1536, '۱٫۵ کیلوبایت'],
    [1024 * 1024, '۱ مگابایت'],
    [5.25 * 1024 ** 3, '۵٫۳ گیگابایت'],
    [3 * 1024 ** 5, '۳٬۰۷۲ ترابایت'],
  ])('bytes(%d) → %s', (n, out) => {
    expect(bytes(n)).toBe(out);
  });

  it('percentBar', () => {
    expect(percentBar(42)).toBe('████████░░░░░░░░░░░░ ۴۲٪');
    expect(percentBar(150, 4)).toBe('████ ۱۰۰٪');
    expect(percentBar(-3, 4)).toBe('░░░░ ۰٪');
    expect(percentBar(Number.NaN, 2, { digits: 'en' })).toBe('░░ 0%');
  });

  it('sparkline', () => {
    expect(sparkline([1, 5, 9])).toBe('▁▅█');
    expect(sparkline([3, 3, 3])).toBe('▁▁▁');
    expect(sparkline([0, Number.NaN, 7])).toBe('▁ █');
    expect(sparkline([])).toBe('');
  });

  it('withLtr keeps LTR fragments on their own lines', () => {
    expect(withLtr('فایل پیدا نشد:', 'src/x.ts', '')).toBe('فایل پیدا نشد:\n  src/x.ts');
  });
});

describe('check-fa-strings', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fa-check-'));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('src/ has no Persian text outside i18n / prompts / knowledge', () => {
    expect(findStrayPersian(join(import.meta.dirname, '..', '..', '..', 'src'))).toEqual([]);
  });

  it('flags string literals, ignores comments, digits and allowed dirs', () => {
    mkdirSync(join(tmp, 'ui', 'cli', 'i18n'), { recursive: true });
    mkdirSync(join(tmp, 'llm', 'prompts'), { recursive: true });
    writeFileSync(
      join(tmp, 'a.ts'),
      [
        '// توضیح فارسی در کامنت',
        "const url = 'https://x.ir'; // سلام",
        "const d = '۰۱۲۳';",
        "throw new Error('خطا');",
        '/* بلوک',
        '   کامنت */',
      ].join('\n'),
    );
    writeFileSync(join(tmp, 'ui', 'cli', 'i18n', 'fa.ts'), "export const x = 'سلام';");
    writeFileSync(join(tmp, 'llm', 'prompts', 'p.ts'), "export const p = 'دستور';");
    expect(findStrayPersian(tmp)).toEqual([{ file: 'a.ts', line: 4, text: "throw new Error('خطا');" }]);
  });
});
