/**
 * T0.5 — fails if anything secret-looking is left in fixtures.
 *
 *   pnpm tsx scripts/check-secrets.ts fixtures/
 *
 * Reports file, rule and a masked excerpt only; never prints a matched secret.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { EMAIL_PLACEHOLDER, IP_PLACEHOLDER, envSecrets } from './redact-fixture.js';

export interface SecretFinding {
  file: string;
  rule: string;
  /** First 3 characters + length only. */
  masked: string;
}

const RULES: Array<{ rule: string; re: RegExp; allow?: (m: string) => boolean }> = [
  { rule: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  { rule: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g },
  { rule: 'api-key', re: /\b(?:sk|rk)[-_](?:live[-_]|test[-_]|proj[-_])?[A-Za-z0-9_-]{16,}/g },
  { rule: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { rule: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    rule: 'conn-string-password',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:([^\s@/'"]+)@/gi,
    allow: (m) => /:(?:REDACTED|\*\*\*|\[REDACTED\]|password|<[^>]+>)@/i.test(m),
  },
  { rule: 'email', re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, allow: (m) => m === EMAIL_PLACEHOLDER || /@example\.(?:com|invalid|org)$/.test(m) },
  {
    rule: 'ipv4',
    re: /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
    allow: (m) => m === IP_PLACEHOLDER || m === '0.0.0.0' || m.startsWith('127.') || m.startsWith('10.') || /^(?:198\.51\.100|203\.0\.113|192\.0\.2)\./.test(m),
  },
];

const mask = (s: string) => `${s.slice(0, 3)}…(${s.length})`;

function walk(p: string, out: string[]): void {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const e of readdirSync(p)) walk(join(p, e), out);
  } else if (/\.(json|txt|log|ya?ml|md)$/i.test(p)) {
    out.push(p);
  }
}

export function findSecrets(target: string, opts: { knownSecrets?: string[]; root?: string } = {}): SecretFinding[] {
  const files: string[] = [];
  walk(target, files);
  const findings: SecretFinding[] = [];
  const root = opts.root ?? process.cwd();
  for (const f of files.sort()) {
    const text = readFileSync(f, 'utf8');
    const file = relative(root, f).split('\\').join('/');
    for (const secret of opts.knownSecrets ?? []) {
      if (secret.length >= 6 && text.includes(secret)) findings.push({ file, rule: 'known-secret', masked: mask(secret) });
    }
    for (const { rule, re, allow } of RULES) {
      for (const m of text.matchAll(re)) {
        if (allow?.(m[0])) continue;
        findings.push({ file, rule, masked: mask(m[0]) });
      }
    }
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  dotenv.config({ quiet: true });
  const target = process.argv[2] ?? 'fixtures/';
  const findings = findSecrets(target, { knownSecrets: envSecrets() });
  for (const f of findings) console.error(`${f.file}: ${f.rule} ${f.masked}`);
  if (findings.length > 0) {
    console.error(`\n${findings.length} possible secret(s) in ${target}`);
    process.exit(1);
  }
  console.log(`OK: no secrets found in ${target}`);
}
