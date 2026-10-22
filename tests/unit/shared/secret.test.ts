import { inspect } from 'node:util';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/shared/logger.js';
import { isSecret, maskSecret, Secret, SECRET_PLACEHOLDER } from '../../../src/shared/secret.js';

describe('Secret', () => {
  const s = new Secret('hunter2-very-secret');

  it('never leaks through implicit serialization', () => {
    expect(String(s)).toBe(SECRET_PLACEHOLDER);
    expect(`${s}`).toBe(SECRET_PLACEHOLDER);
    expect(JSON.stringify({ password: s })).toBe('{"password":"[SECRET]"}');
    expect(inspect({ s })).not.toContain('hunter2');
    expect(Object.keys(s)).toEqual([]);
  });

  it('reveal() returns the value', () => {
    expect(s.reveal()).toBe('hunter2-very-secret');
    expect(isSecret(s)).toBe(true);
    expect(isSecret('x')).toBe(false);
  });

  it('maskSecret shows at most 4 chars', () => {
    expect(maskSecret(s)).toBe('hunt••••(19)');
    expect(maskSecret(new Secret('abc'))).toBe('••••');
  });

  it('pino output contains [SECRET], not the value, even under a non-sensitive key', () => {
    const lines: string[] = [];
    const log = createLogger({
      level: 'info',
      destination: new Writable({
        write(c, _e, cb) {
          lines.push(String(c));
          cb();
        },
      }),
    });
    log.info({ creds: { user: 'u', pass: s } }, 'ftp');
    expect(lines.join('')).not.toContain('hunter2');
    expect(lines.join('')).toContain(SECRET_PLACEHOLDER);
  });
});
