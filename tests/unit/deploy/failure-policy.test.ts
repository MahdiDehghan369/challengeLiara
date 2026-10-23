import { describe, expect, it } from 'vitest';
import { classifyFailure, MAX_FIX_ATTEMPTS, MAX_UPLOAD_RETRIES, routeFor } from '../../../src/deploy/failure-policy.js';
import { ExternalCommandError, LiaraApiError, ValidationError } from '../../../src/shared/errors.js';

const base = { isFirstDeploy: false, attempt: 1 };
const cliError = (tail: string[], evidence: string[], retryable = false) =>
  new ExternalCommandError('deploy failed', { messageFa: 'x', details: { tail, evidence }, retryable });

describe('classifyFailure', () => {
  it('maps each failed step / output to its kind', () => {
    expect(classifyFailure({ ...base, failedStep: 'preflight', error: new ValidationError('no token', { messageFa: 'x' }) }).kind).toBe('preflight');
    expect(classifyFailure({ ...base, failedStep: 'configure', error: new Error('x') }).kind).toBe('preflight');
    expect(classifyFailure({ ...base, failedStep: 'verify', error: new Error('x') }).kind).toBe('runtime');
    expect(classifyFailure({ ...base, failedStep: 'deploy', error: cliError(['Uploading source 37%', ' »   Error: socket hang up'], ['cli: exit 2']) }).kind).toBe('upload');
    expect(classifyFailure({ ...base, failedStep: 'deploy', error: new LiaraApiError('502', { status: 502, messageFa: 'x' }) }).kind).toBe('upload');
    expect(classifyFailure({ ...base, failedStep: 'deploy', error: cliError(['Uploading source 100%', 'Building...', 'Build failed'], ['cli: exit 1']) }).kind).toBe('build');
    expect(classifyFailure({ ...base, failedStep: 'deploy', error: cliError(['Creating release...'], ['cli: timeout'], true) }).kind).toBe('timeout');
  });
});

describe('routeFor', () => {
  const f = (kind: Parameters<typeof routeFor>[0]['kind'], extra = {}) => ({ ...base, stage: 'deploy', kind, evidence: [], tail: [], ...extra });
  it('follows the table and its caps', () => {
    expect(routeFor(f('preflight'), { uploadRetries: 0, fixAttempts: 0 })).toBe('stop');
    expect(routeFor(f('upload'), { uploadRetries: MAX_UPLOAD_RETRIES - 1, fixAttempts: 0 })).toBe('offer-retry');
    expect(routeFor(f('upload'), { uploadRetries: MAX_UPLOAD_RETRIES, fixAttempts: 0 })).toBe('stop');
    expect(routeFor(f('build'), { uploadRetries: 0, fixAttempts: MAX_FIX_ATTEMPTS - 1 })).toBe('build-analysis');
    expect(routeFor(f('build'), { uploadRetries: 0, fixAttempts: MAX_FIX_ATTEMPTS })).toBe('stop');
    // a timeout is never retried automatically, whatever the counters say
    expect(routeFor(f('timeout'), { uploadRetries: 0, fixAttempts: 0 })).toBe('wait-or-inspect');
    expect(routeFor(f('runtime', { previousHealthy: 'dep-1' }), { uploadRetries: 0, fixAttempts: 0 })).toBe('rollback-first');
    expect(routeFor(f('runtime', { isFirstDeploy: true, previousHealthy: 'dep-1' }), { uploadRetries: 0, fixAttempts: 0 })).toBe('sre');
    expect(routeFor(f('runtime'), { uploadRetries: 0, fixAttempts: 0 })).toBe('sre');
  });
});
