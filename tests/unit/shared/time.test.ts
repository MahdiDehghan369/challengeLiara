import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../src/shared/errors.js';
import { formatFaDuration, nowUnix, parseRelative, toFaDigits } from '../../../src/shared/time.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('time', () => {
  it('nowUnix returns whole seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:01.999Z'));
    expect(nowUnix()).toBe(1767225601);
  });

  it.each([
    ['30s', 30],
    ['5m', 300],
    ['1h', 3600],
    ['2d', 172_800],
    ['1w', 604_800],
    ['1h30m', 5400],
    [' 1h 30m ', 5400],
    ['1H', 3600],
  ])('parseRelative(%j) = %i', (input, expected) => {
    expect(parseRelative(input)).toBe(expected);
  });

  it.each(['', 'h', '1x', '1h foo', '-1h', '1.5h'])('parseRelative(%j) throws', (input) => {
    expect(() => parseRelative(input)).toThrow(ValidationError);
  });

  it('toFaDigits', () => {
    expect(toFaDigits(1405)).toBe('۱۴۰۵');
  });

  it('formatFaDuration shows at most two units', () => {
    expect(formatFaDuration(0)).toBe('۰ ثانیه');
    expect(formatFaDuration(45)).toBe('۴۵ ثانیه');
    expect(formatFaDuration(5400)).toBe('۱ ساعت و ۳۰ دقیقه');
    expect(formatFaDuration(90_061)).toBe('۱ روز و ۱ ساعت');
  });
});
