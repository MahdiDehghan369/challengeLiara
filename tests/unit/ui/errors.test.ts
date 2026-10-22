import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/config/env.js';
import {
  ApprovalDeniedError,
  BudgetExceededError,
  ExternalCommandError,
  LiaraApiError,
  RateLimitError,
} from '../../../src/shared/errors.js';
import { explainError, formatError } from '../../../src/ui/cli/errors.js';

const configError = (env: Record<string, string>) => {
  try {
    loadConfig(env);
  } catch (e) {
    return e;
  }
  throw new Error('expected a config error');
};

describe('explainError mapping', () => {
  it.each([
    ['missing Liara token', configError({ LIARA_MODE: 'live', LLM_MODE: 'mock' }), 'CONFIG_MISSING_KEY', 'LIARA_API_TOKEN'],
    ['missing BoxAPI key', configError({ LIARA_MODE: 'mock', LLM_MODE: 'live' }), 'CONFIG_MISSING_KEY', 'BOXAPI_API_KEY'],
    ['401', new LiaraApiError('x', { status: 401, code: 'UNAUTHORIZED' }), 'UNAUTHORIZED', 'LIARA_API_TOKEN'],
    ['network', new LiaraApiError('x', { code: 'NETWORK_ERROR' }), 'NETWORK_ERROR', 'اینترنت'],
    ['timeout', new LiaraApiError('x', { code: 'TIMEOUT' }), 'TIMEOUT', 'اینترنت'],
    ['409 name taken', new LiaraApiError('x', { status: 409, code: 'APP_NAME_TAKEN' }), 'APP_NAME_TAKEN', 'نام دیگر'],
    ['low balance (402)', new LiaraApiError('x', { status: 402 }), 'INSUFFICIENT_BALANCE', 'شارژ'],
    ['low balance (remote text)', new LiaraApiError('x', { status: 400, details: { remote: 'Insufficient balance' } }), 'INSUFFICIENT_BALANCE', 'شارژ'],
    ['denied', new ApprovalDeniedError('x'), 'APPROVAL_DENIED', 'تغییری'],
    ['budget', new BudgetExceededError('x'), 'BUDGET_EXCEEDED', 'جلسه'],
  ])('%s', (_label, err, code, doContains) => {
    const e = explainError(err);
    expect(e.code).toBe(code);
    expect(e.doFa).toContain(doContains);
    expect(e.whatFa.length).toBeGreaterThan(0);
  });

  it('429 with Retry-After → wait time in Persian', () => {
    const e = explainError(new RateLimitError('429', { retryAfterMs: 30_000 }));
    expect(e.code).toBe('RATE_LIMIT');
    expect(e.doFa).toContain('۳۰ ثانیه');
    expect(explainError(new RateLimitError('429')).doFa).toContain('صبر');
  });

  it('CLI not installed → install command', () => {
    const e = explainError(new ExternalCommandError('spawn liara ENOENT'));
    expect(e).toMatchObject({ code: 'CLI_MISSING', command: 'npm install -g @liara/cli' });
    expect(explainError(new ExternalCommandError('x', { details: { cliMissing: true } })).code).toBe('CLI_MISSING');
  });

  it('deploy / wait timeout → check logs', () => {
    const e = explainError(new LiaraApiError('x', { code: 'WAIT_TIMEOUT', details: { app: 'shop' } }));
    expect(e).toMatchObject({ code: 'WAIT_TIMEOUT', command: 'siavash logs shop' });
    expect(explainError(new ExternalCommandError('x', { details: { timedOut: true } })).code).toBe('COMMAND_TIMEOUT');
  });

  it('app not found keeps the closest-name suggestion', () => {
    const err = new LiaraApiError('App not found: shp', {
      code: 'APP_NOT_FOUND',
      status: 404,
      messageFa: 'اپ «shp» پیدا نشد. منظورتان «shop» است؟',
      details: { name: 'shp', suggestion: 'shop' },
    });
    const e = explainError(err);
    expect(e.whatFa).toContain('shop');
    expect(e.doFa).toContain('shop');
    const none = explainError(new LiaraApiError('x', { code: 'APP_NOT_FOUND', details: { name: 'zzz' } }));
    expect(none.command).toBe('siavash apps');
  });

  it('unknown errors get a generic message', () => {
    expect(explainError(new TypeError('boom')).code).toBe('UNEXPECTED');
    expect(explainError('weird').code).toBe('UNEXPECTED');
  });
});

describe('formatError', () => {
  const err = new TypeError("Cannot read properties of undefined (reading 'x')");

  it('no raw stack trace without --verbose', () => {
    const out = formatError(err);
    expect(out).toContain('چه اتفاقی افتاد');
    expect(out).toContain('چه کار کنم');
    expect(out).toContain('--verbose');
    expect(out).not.toMatch(/\n\s+at /);
    expect(out).not.toContain('TypeError');
  });

  it('--verbose adds technical details and the stack', () => {
    const out = formatError(err, { verbose: true });
    expect(out).toContain('TypeError');
    expect(out).toMatch(/\n\s+at /);
  });

  it('technical details are redacted', () => {
    const e = new LiaraApiError('connect failed postgres://u:hunter2pw@db:5432/x', { code: 'NETWORK_ERROR', details: { token: 'Bearer abcdefghijklmnopqrstuv' } });
    const out = formatError(e, { verbose: true });
    expect(out).not.toContain('hunter2pw');
    expect(out).not.toContain('abcdefghijklmnopqrstuv');
  });

  it('commands are printed on their own line', () => {
    const out = formatError(new ExternalCommandError('spawn liara ENOENT'));
    expect(out.split('\n')).toContain('  npm install -g @liara/cli');
  });
});
