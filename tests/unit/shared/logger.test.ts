import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED, scrubString } from '../../../src/shared/logger.js';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  const log = createLogger({ level: 'info', destination: stream });
  return { log, lines, json: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('logger redaction', () => {
  it('redacts the authorization key', () => {
    const { log, lines, json } = capture();
    log.info({ authorization: 'Bearer x' }, 'call');
    expect(json()[0]?.authorization).toBe(REDACTED);
    expect(lines.join('')).not.toContain('Bearer x');
  });

  it('redacts sensitive keys at any depth and any case', () => {
    const { log, lines } = capture();
    log.info({
      req: { headers: { Authorization: 'Bearer deep-secret-1' } },
      db: { password: 'pw-secret-2' },
      cfg: { apiKey: 'k-secret-3', nested: { secret: 's-secret-4', token: 't-secret-5' } },
    });
    const out = lines.join('');
    for (const s of ['deep-secret-1', 'pw-secret-2', 'k-secret-3', 's-secret-4', 't-secret-5']) {
      expect(out).not.toContain(s);
    }
    expect(out).toContain(REDACTED);
  });

  it('redacts token= in URLs inside objects', () => {
    const { log, lines } = capture();
    log.info({ url: 'wss://api.liara.ir?token=abc&cmd=/bin/bash' });
    const out = lines.join('');
    expect(out).not.toContain('token=abc');
    expect(out).toContain(`token=${REDACTED}`);
    expect(out).toContain('cmd=/bin/bash');
  });

  it('redacts token= in the log message itself', () => {
    const { log, lines } = capture();
    log.info('connecting to wss://api.liara.ir?token=abc');
    const out = lines.join('');
    expect(out).not.toContain('token=abc');
    expect(out).toContain(REDACTED);
  });

  it('scrubString leaves unrelated text alone', () => {
    expect(scrubString('https://x.liara.run/health?a=1')).toBe('https://x.liara.run/health?a=1');
    expect(scrubString('https://a?api_token=zzz&b=1')).toBe(`https://a?api_token=${REDACTED}&b=1`);
  });
});
