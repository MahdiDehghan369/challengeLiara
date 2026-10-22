import { describe, expect, it } from 'vitest';
import {
  ApprovalDeniedError,
  ExternalCommandError,
  isSiavashError,
  LiaraApiError,
  LlmError,
  RateLimitError,
  SiavashError,
  ValidationError,
} from '../../../src/shared/errors.js';
import { err, isErr, isOk, ok, type Result } from '../../../src/shared/result.js';

describe('errors', () => {
  it('every class carries code, messageFa, details, retryable', () => {
    const all = [
      new LiaraApiError('x', { status: 404 }),
      new ValidationError('x'),
      new ApprovalDeniedError('x'),
      new RateLimitError('x', { retryAfterMs: 1000 }),
      new ExternalCommandError('x', { exitCode: 1 }),
      new LlmError('x'),
    ];
    const codes = new Set<string>();
    for (const e of all) {
      expect(e).toBeInstanceOf(SiavashError);
      expect(e).toBeInstanceOf(Error);
      expect(isSiavashError(e)).toBe(true);
      expect(typeof e.code).toBe('string');
      expect(e.messageFa.length).toBeGreaterThan(0);
      expect(e.details).toEqual({});
      expect(typeof e.retryable).toBe('boolean');
      codes.add(e.code);
    }
    expect(codes.size).toBe(all.length);
  });

  it('LiaraApiError is retryable for 5xx only, by default', () => {
    expect(new LiaraApiError('x', { status: 503 }).retryable).toBe(true);
    expect(new LiaraApiError('x', { status: 404 }).retryable).toBe(false);
    expect(new LiaraApiError('x', { status: 404, retryable: true }).retryable).toBe(true);
  });

  it('RateLimitError is retryable and keeps retryAfterMs', () => {
    const e = new RateLimitError('x', { retryAfterMs: 2000 });
    expect(e.retryable).toBe(true);
    expect(e.retryAfterMs).toBe(2000);
  });

  it('custom messageFa and details override defaults', () => {
    const e = new ValidationError('x', { messageFa: 'پیام', details: { a: 1 } });
    expect(e.messageFa).toBe('پیام');
    expect(e.details).toEqual({ a: 1 });
    expect(e.name).toBe('ValidationError');
  });
});

describe('result', () => {
  it('ok / err / isOk / isErr', () => {
    const a: Result<number> = ok(1);
    const b: Result<number> = err(new ValidationError('bad'));
    expect(isOk(a)).toBe(true);
    expect(isErr(a)).toBe(false);
    expect(isOk(b)).toBe(false);
    expect(isErr(b)).toBe(true);
    if (isOk(a)) expect(a.data).toBe(1);
    if (isErr(b)) expect(b.error.code).toBe('VALIDATION_ERROR');
  });
});
