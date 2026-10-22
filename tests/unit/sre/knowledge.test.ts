import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_PLATFORMS,
  loadKnowledge,
  matchKnowledge,
  parseKnowledge,
} from '../../../src/sre/knowledge/index.js';
import { ValidationError } from '../../../src/shared/errors.js';

const patterns = loadKnowledge();

describe('knowledge base file', () => {
  it('validates and has at least 40 patterns', () => {
    expect(patterns.length).toBeGreaterThanOrEqual(40);
  });

  it('covers every platform', () => {
    for (const platform of KNOWLEDGE_PLATFORMS) {
      expect(patterns.some((p) => p.platforms.includes(platform)), platform).toBe(true);
    }
  });

  it.each(patterns.map((p) => [p.id, p] as const))('%s matches its sample', (_id, p) => {
    expect(p.re.test(p.sample)).toBe(true);
    expect(matchKnowledge(p.sample).map((m) => m.pattern.id)).toContain(p.id);
  });

  it('every {n} placeholder refers to an existing capture group', () => {
    for (const p of patterns) {
      const groupCount = new RegExp(`${p.regex}|`, p.flags).exec('')!.length - 1;
      const texts = [p.likelyCauseFa, ...p.fixes.flatMap((f) => [f.descriptionFa, ...Object.values(f.params ?? {}).map(String)])];
      for (const t of texts) {
        for (const [, n] of t.matchAll(/\{(\d)\}/g)) expect(Number(n), p.id).toBeLessThanOrEqual(groupCount);
      }
    }
  });
});

describe('matchKnowledge', () => {
  it.each([
    ["Error: Cannot find module 'dotenv'", 'node-module-not-found'],
    ['Error: listen EADDRINUSE: address already in use 0.0.0.0:8080', 'node-eaddrinuse'],
    ['FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory', 'node-heap-oom'],
    ['Error: connect ECONNREFUSED 127.0.0.1:5432', 'db-econnrefused-localhost-postgres'],
    ['You have 3 unapplied migration(s). Run \'python manage.py migrate\' to apply them.', 'django-unapplied-migrations'],
    ["Invalid HTTP_HOST header: 'x.liara.run'", undefined],
    ["django.core.exceptions.DisallowedHost: Invalid HTTP_HOST header: 'x.liara.run'.", 'django-disallowed-host'],
    ['Illuminate\\Encryption\\MissingAppKeyException: No application encryption key has been specified.', 'laravel-app-key-missing'],
    ['sh: next: command not found', 'next-binary-not-found'],
    ["Error: EROFS: read-only file system, mkdir '/app/data'", 'fs-erofs'],
    ['Error: ENOSPC: no space left on device', 'fs-enospc'],
  ])('%s → %s', (text, id) => {
    const first = matchKnowledge(text, { first: true })[0];
    expect(first?.pattern.id).toBe(id);
  });

  it('specific patterns come before generic ones', () => {
    const ids = matchKnowledge('Error: connect ECONNREFUSED 127.0.0.1:5432').map((m) => m.pattern.id);
    expect(ids[0]).toBe('db-econnrefused-localhost-postgres');
    expect(ids).toContain('net-econnrefused');
  });

  it('fills {n} placeholders from capture groups', () => {
    const [m] = matchKnowledge("KeyError: 'STRIPE_KEY'", { first: true });
    expect(m?.pattern.id).toBe('py-missing-env-keyerror');
    expect(m?.likelyCauseFa).toContain('STRIPE_KEY');
    expect(m?.fixes[0]).toMatchObject({ actionType: 'set_env', params: { name: 'STRIPE_KEY' } });
  });

  it('no match for healthy lines', () => {
    expect(matchKnowledge('GET /api/items 200 3ms')).toEqual([]);
    expect(matchKnowledge('Server listening on port 3000')).toEqual([]);
  });

  it('matches real CR characters in CRLF shebang errors', () => {
    expect(matchKnowledge("/usr/bin/env: 'bash\r': No such file or directory")[0]?.pattern.id).toBe('docker-crlf-shebang');
  });
});

describe('parseKnowledge validation', () => {
  const base = {
    id: 'x-one',
    regex: 'boom',
    category: 'code',
    platforms: ['node'],
    titleFa: 'ت',
    likelyCauseFa: 'ع',
    fixes: [{ actionType: 'manual', descriptionFa: 'ر' }],
    sample: 'boom',
  };
  const yaml = (patterns: unknown[]) => JSON.stringify({ version: 1, patterns });

  it('accepts a minimal valid file', () => {
    expect(parseKnowledge(yaml([base]))).toHaveLength(1);
  });

  it.each([
    ['unknown actionType', { ...base, fixes: [{ actionType: 'delete_app', descriptionFa: 'x' }] }],
    ['unknown category', { ...base, category: 'magic' }],
    ['invalid regex', { ...base, regex: '(' }],
    ['global flag', { ...base, flags: 'g' }],
    ['no fixes', { ...base, fixes: [] }],
  ])('rejects %s', (_label, p) => {
    expect(() => parseKnowledge(yaml([p]))).toThrow(ValidationError);
  });

  it('rejects duplicate ids and invalid YAML', () => {
    expect(() => parseKnowledge(yaml([base, base]))).toThrow(ValidationError);
    expect(() => parseKnowledge('version: [1')).toThrow(ValidationError);
  });

  it('missing file → ValidationError', () => {
    expect(() => loadKnowledge('does/not/exist.yaml')).toThrow(ValidationError);
  });
});
