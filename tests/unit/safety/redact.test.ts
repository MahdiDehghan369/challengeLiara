import { describe, expect, it } from 'vitest';
import { REDACTED, Redactor, redactObject, redactText } from '../../../src/safety/redact.js';
import { Secret } from '../../../src/shared/secret.js';

// Each sample: [description, input text, the secret part that must disappear]
const SAMPLES: Array<[string, string, string]> = [
  ['bearer header', 'Authorization: Bearer abcDEF123456.xyz-_~+/=', 'abcDEF123456.xyz'],
  ['basic header', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA=='],
  ['jwt', 'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U ok', 'eyJhbGciOiJIUzI1NiJ9'],
  ['openai key', 'OPENAI key sk-abcdefghijklmnopqrstuvwxyz123456', 'sk-abcdefghijklmnopqrstuvwxyz123456'],
  ['openai project key', 'using sk-proj-AbCdEfGhIjKlMnOpQrStUv_1234', 'sk-proj-AbCdEfGhIjKlMnOpQrStUv_1234'],
  ['stripe live key', 'stripe sk_live_51HxyzABCDEFGHIJKLMNOPQ', 'sk_live_51HxyzABCDEFGHIJKLMNOPQ'],
  ['github token', 'git push https ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github fine-grained pat', 'pat github_pat_11ABCDEFG0123456789_abcdefghijklmnop', 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop'],
  ['aws key id', 'aws AKIAIOSFODNN7EXAMPLE used', 'AKIAIOSFODNN7EXAMPLE'],
  ['slack token', 'slack xoxb-123456789012-abcdefghij', 'xoxb-123456789012-abcdefghij'],
  ['postgres url', 'Error connecting to postgres://admin:S3cr3tPw@db.liara:5432/app', 'S3cr3tPw'],
  ['postgresql url', 'DATABASE_URL is postgresql://u:p4ss-word@h/db', 'p4ss-word'],
  ['mysql url', 'mysql://root:rootpw123@mysql:3306/shop failed', 'rootpw123'],
  ['mongodb srv url', 'MongoServerError at mongodb+srv://user:mongoPass99@cluster0.x.net/db', 'mongoPass99'],
  ['redis url', 'redis://default:redisSecret1@redis:6379', 'redisSecret1'],
  ['liara console ws', 'wss://api.liara.ir?token=abcdef123456&cmd=/bin/bash&project_id=1', 'abcdef123456'],
  ['api_key query', 'GET https://x.com/v1?api_key=QWERTY987654&page=2', 'QWERTY987654'],
  ['signed s3 url', 'https://s3.example/b?X-Amz-Signature=deadbeefcafe1234&X-Amz-Date=1', 'deadbeefcafe1234'],
  ['env dump password', 'DB_PASSWORD=hunter2hunter2', 'hunter2hunter2'],
  ['env dump json secret', '{"JWT_SECRET": "very-long-jwt-secret-value"}', 'very-long-jwt-secret-value'],
  ['yaml api key', 'stripe_api_key: abc123def456ghi', 'abc123def456ghi'],
  ['access token assignment', 'ACCESS_TOKEN = "tok_9f8e7d6c5b4a"', 'tok_9f8e7d6c5b4a'],
  ['private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA1234'],
];

const NORMAL = [
  'GET /api/items 200 3ms',
  'Server listening on port 3000',
  'TypeError: Cannot read properties of undefined (reading \'id\') at /app/src/routes/items.js:42:17',
  'Error: connect ECONNREFUSED 127.0.0.1:5432',
  'https://shop-api.liara.run/health returned 503',
  'The password field is required',
  'token count: 1532',
  'برنامه با موفقیت مستقر شد',
  'npm ERR! missing script: build',
  'Deployed release v3 at 2026-10-20T12:00:00Z',
];

describe('redactText', () => {
  it(`hides all ${SAMPLES.length} secret samples`, () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(20);
    for (const [name, input, secretPart] of SAMPLES) {
      const out = redactText(input);
      expect(out, name).not.toContain(secretPart);
      expect(out, name).toMatch(/\[REDACTED\]|\*\*\*/);
    }
  });

  it('keeps connection-string structure (user and host visible)', () => {
    expect(redactText('postgres://user:pass1234@db:5432/app')).toBe('postgres://user:***@db:5432/app');
  });

  it('keeps other query params of the Liara console URL', () => {
    expect(redactText('wss://api.liara.ir?token=abc123456&cmd=/bin/bash')).toBe(
      `wss://api.liara.ir?token=${REDACTED}&cmd=/bin/bash`,
    );
  });

  it.each(NORMAL)('leaves normal text untouched: %s', (s) => {
    expect(redactText(s)).toBe(s);
  });
});

describe('Redactor known secrets', () => {
  it('hides registered session values anywhere, but ignores very short ones', () => {
    const r = new Redactor();
    r.addKnownSecret('my-plain-env-value-42');
    r.addKnownSecret(new Secret('another-secret-abc'));
    r.addKnownSecret('abc');
    const out = r.redactText('value=my-plain-env-value-42 and another-secret-abc; abc stays');
    expect(out).toBe(`value=${REDACTED} and ${REDACTED}; abc stays`);
    r.clearKnownSecrets();
    expect(r.redactText('my-plain-env-value-42')).toBe('my-plain-env-value-42');
  });
});

describe('redactObject', () => {
  it('recurses, hides sensitive keys and Secrets, and redacts strings', () => {
    const input = {
      app: 'shop',
      headers: { Authorization: 'Bearer abcdefghijkl', accept: 'json' },
      db: { password: 'pw-xyz-123', host: 'db' },
      creds: new Secret('s'),
      logs: ['ok', 'postgres://u:pw999999@h/db'],
      count: 3,
      when: new Date(0),
      emptyToken: '',
    };
    const out = redactObject(input);
    expect(out).toEqual({
      app: 'shop',
      headers: { Authorization: REDACTED, accept: 'json' },
      db: { password: REDACTED, host: 'db' },
      creds: '[SECRET]',
      logs: ['ok', 'postgres://u:***@h/db'],
      count: 3,
      when: new Date(0),
      emptyToken: '',
    });
    expect(input.db.password).toBe('pw-xyz-123');
  });
});
