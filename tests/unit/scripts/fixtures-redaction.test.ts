import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findSecrets } from '../../../scripts/check-secrets.js';
import { EMAIL_PLACEHOLDER, IP_PLACEHOLDER, PLACEHOLDER, redactFixture } from '../../../scripts/redact-fixture.js';

const TOKEN = 'liara-token-abcdef123456';

describe('redactFixture', () => {
  it('replaces sensitive keys, emails, IPs, connection strings and known secrets; keeps shape', () => {
    const input = {
      user: { email: 'me@real-mail.ir', balance: 2_345_678, accountType: 'personal', phone: '09120000000' },
      envs: [{ key: 'DATABASE_URL', value: 'postgres://app:pw123@10.1.2.3:5432/db' }],
      note: `called with ${TOKEN} from 185.12.34.56, contact admin@corp.ir`,
      url: 'mysql://root:hunter2@db.host:3306/x',
      metrics: { value: [1760000000, '0.12'] },
      count: 3,
    };
    const out = redactFixture(input, { knownSecrets: [TOKEN] });
    expect(out.user).toEqual({ email: PLACEHOLDER, balance: 1_000_000, accountType: 'personal', phone: PLACEHOLDER });
    expect(out.envs[0]).toEqual({ key: 'DATABASE_URL', value: PLACEHOLDER });
    expect(out.note).not.toContain(TOKEN);
    expect(out.note).toContain(IP_PLACEHOLDER);
    expect(out.note).toContain(EMAIL_PLACEHOLDER);
    expect(out.url).not.toContain('hunter2');
    expect(out.metrics).toEqual({ value: [1760000000, '0.12'] });
    expect(out.count).toBe(3);
  });
});

describe('findSecrets', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('flags known secrets and secret-looking strings; never returns the value', () => {
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ t: TOKEN, jwt: 'eyJhbGciOi.eyJzdWIiOjEyMzQ1.c2lnbmF0dXJlMTIz', ip: '185.12.34.56' }));
    const f = findSecrets(dir, { knownSecrets: [TOKEN], root: dir });
    expect(f.map((x) => x.rule).sort()).toEqual(['ipv4', 'jwt', 'known-secret']);
    expect(JSON.stringify(f)).not.toContain(TOKEN);
  });

  it('passes redacted output and placeholders', () => {
    const clean = mkdtempSync(join(tmpdir(), 'secrets-clean-'));
    try {
      const data = redactFixture({ email: 'x@y.ir', s: `token ${TOKEN} at 185.1.1.1 postgres://u:p4ss@h/db` }, { knownSecrets: [TOKEN] });
      writeFileSync(join(clean, 'b.json'), JSON.stringify(data));
      expect(findSecrets(clean, { knownSecrets: [TOKEN], root: clean })).toEqual([]);
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it('committed fixtures are clean', () => {
    expect(findSecrets(join(import.meta.dirname, '..', '..', '..', 'fixtures'))).toEqual([]);
  });
});
