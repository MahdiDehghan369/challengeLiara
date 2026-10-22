import { isSecret, SECRET_PLACEHOLDER } from '../shared/secret.js';

/**
 * Redaction applied before anything (logs, code, tool output) is sent to an LLM or written to
 * reports. Patterns are deliberately specific so ordinary text stays untouched.
 */

export const REDACTED = '[REDACTED]';

type Rule = { re: RegExp; replace: string | ((...m: string[]) => string) };

const RULES: Rule[] = [
  // PEM private keys
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: `-----BEGIN PRIVATE KEY-----${REDACTED}-----END PRIVATE KEY-----`,
  },
  // Authorization: Bearer / Basic
  { re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, replace: `$1${REDACTED}` },
  { re: /\b(Basic\s+)[A-Za-z0-9+/=]{8,}/g, replace: `$1${REDACTED}` },
  // JWT
  { re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, replace: REDACTED },
  // OpenAI-style / Stripe keys
  { re: /\b(?:sk|rk|pk)[-_](?:live[-_]|test[-_]|proj[-_])?[A-Za-z0-9_-]{16,}\b/g, replace: REDACTED },
  // GitHub tokens
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replace: REDACTED },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: REDACTED },
  // AWS access key id
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REDACTED },
  // Slack tokens
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  // Credentials inside URLs / connection strings: scheme://user:pass@host → scheme://user:***@host
  { re: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:)([^\s@/'"]+)(@)/gi, replace: '$1***$3' },
  // Secret-looking query params (incl. wss://api.liara.ir?token=...)
  {
    re: /([?&](?:token|api[-_]?token|access[-_]?token|api[-_]?key|apikey|secret|password|passwd|sig|signature|x-amz-signature|x-amz-credential)=)[^&\s"'#]+/gi,
    replace: `$1${REDACTED}`,
  },
  // KEY=value / KEY: value for secret-like names (env dumps, configs, logs)
  {
    re: /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*["']?\s*[=:]\s*)(["']?)(?!\[REDACTED\])([^\s"',;&]{3,})\2/gi,
    replace: (_m: string, pre: string, q: string) => `${pre}${q}${REDACTED}${q}`,
  },
];

const SENSITIVE_KEY_RE = /^(?:authorization|password|passwd|secret|token|api[-_]?key|apikey|access[-_]?token|private[-_]?key|root_password|client[-_]?secret)$/i;

export class Redactor {
  private readonly known = new Set<string>();

  /** Registers a concrete secret value seen in this session (e.g. an env value the user typed). */
  addKnownSecret(value: string | { reveal(): string }): void {
    const v = typeof value === 'string' ? value : value.reveal();
    // very short values would wreck ordinary text
    if (v.length >= 6) this.known.add(v);
  }

  clearKnownSecrets(): void {
    this.known.clear();
  }

  redactText(s: string): string {
    let out = s;
    // longest first so overlapping values are fully hidden
    for (const v of [...this.known].sort((a, b) => b.length - a.length)) out = out.split(v).join(REDACTED);
    for (const r of RULES) out = out.replace(r.re, r.replace as string);
    return out;
  }

  redactObject<T>(obj: T, depth = 0): T {
    if (depth > 20) return obj;
    if (typeof obj === 'string') return this.redactText(obj) as T;
    if (isSecret(obj)) return SECRET_PLACEHOLDER as T;
    if (Array.isArray(obj)) return obj.map((v) => this.redactObject(v, depth + 1)) as T;
    if (obj && typeof obj === 'object') {
      if (obj instanceof Date) return obj;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEY_RE.test(k) && v !== null && v !== undefined && v !== '' ? REDACTED : this.redactObject(v, depth + 1);
      }
      return out as T;
    }
    return obj;
  }
}

/** Process-wide redactor shared by the agent session. */
export const defaultRedactor = new Redactor();

export function redactText(s: string): string {
  return defaultRedactor.redactText(s);
}

export function redactObject<T>(obj: T): T {
  return defaultRedactor.redactObject(obj);
}
