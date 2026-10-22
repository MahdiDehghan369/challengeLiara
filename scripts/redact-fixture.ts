/**
 * T0.5 — redacts a recorded fixture so it can be committed.
 *
 *   pnpm tsx scripts/redact-fixture.ts <file.json> [...]   (rewrites in place)
 *
 * Sensitive keys → placeholders; strings → `redactText` + email / IPv4 / connection-string rules;
 * known secret values (from .env) → placeholder anywhere they appear.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { redactText } from '../src/safety/redact.js';

export const PLACEHOLDER = 'REDACTED';
export const EMAIL_PLACEHOLDER = 'user@example.invalid';
export const IP_PLACEHOLDER = '203.0.113.1';

/** Keys whose values are always replaced (case-insensitive, matched on the whole key). */
const SENSITIVE_KEY_RE =
  /^(?:password|passwd|root_password|secret|secretkey|accesskey|token|api[-_]?token|access[-_]?token|refresh[-_]?token|api[-_]?key|private[-_]?key|authorization|cookie|email|phone|mobile|phonenumber|national[-_]?code|nationalid|iban|card|cardnumber|first[-_]?name|last[-_]?name|fullname|avatar|ip|ipaddress|connectionstring|dsn|value)$/i;

/** Keys whose values are replaced when they are numbers (personal financial data). */
const PRIVATE_NUMBER_KEY_RE = /^(?:balance|credit|debt)$/i;

export interface RedactOptions {
  /** Concrete secret values (e.g. the API token) to replace wherever they appear. */
  knownSecrets?: string[];
}

const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const IPV4_RE = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const CONN_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/'"]+):([^\s@/'"]+)@/gi;

export function redactString(s: string, opts: RedactOptions = {}): string {
  let out = s;
  for (const k of [...(opts.knownSecrets ?? [])].filter((x) => x.length >= 6).sort((a, b) => b.length - a.length)) {
    out = out.split(k).join(PLACEHOLDER);
  }
  out = redactText(out);
  out = out.replace(CONN_RE, `$1${PLACEHOLDER}:${PLACEHOLDER}@`);
  out = out.replace(EMAIL_RE, (m) => (m === EMAIL_PLACEHOLDER ? m : EMAIL_PLACEHOLDER));
  out = out.replace(IPV4_RE, (m) => (m === IP_PLACEHOLDER || m === '0.0.0.0' || m.startsWith('127.') ? m : IP_PLACEHOLDER));
  return out;
}

export function redactFixture<T>(value: T, opts: RedactOptions = {}, depth = 0): T {
  if (depth > 50) return value;
  if (typeof value === 'string') return redactString(value, opts) as T;
  if (Array.isArray(value)) return value.map((v) => redactFixture(v, opts, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k) && v !== null && v !== undefined && v !== '' && typeof v !== 'object') {
        out[k] = typeof v === 'number' ? 0 : typeof v === 'boolean' ? v : PLACEHOLDER;
      } else if (PRIVATE_NUMBER_KEY_RE.test(k) && typeof v === 'number') {
        out[k] = 1_000_000;
      } else if (PRIVATE_NUMBER_KEY_RE.test(k) && typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) {
        out[k] = '1000000';
      } else {
        out[k] = redactFixture(v, opts, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}

/** Secret values from .env (never printed). */
export function envSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['LIARA_API_TOKEN', 'BOXAPI_API_KEY', 'LIARA_TEAM_ID']
    .map((k) => env[k]?.trim() ?? '')
    .filter((v) => v.length >= 6);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config({ quiet: true });
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: redact-fixture.ts <file.json> [...]');
    process.exit(2);
  }
  for (const f of files) {
    const data: unknown = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, `${JSON.stringify(redactFixture(data, { knownSecrets: envSecrets() }), null, 2)}\n`, 'utf8');
    console.log(`redacted ${f}`);
  }
}
