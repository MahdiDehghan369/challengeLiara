import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export const REDACTED = '[REDACTED]';

/** Keys whose values are always hidden, at any depth (case-insensitive). */
const SENSITIVE_KEYS = new Set(['authorization', 'token', 'password', 'apikey', 'secret', 'api_key']);

/** pino path-based redaction (fast path for the common shapes). */
export const REDACT_PATHS = [
  'authorization',
  'token',
  'password',
  'apiKey',
  'secret',
  '*.authorization',
  '*.token',
  '*.password',
  '*.apiKey',
  '*.secret',
  'headers.authorization',
  'req.headers.authorization',
];

const URL_TOKEN_RE = /([?&](?:token|api[-_]?token|access_token)=)[^&\s"']+/gi;

/** Hides `token=...` query values in any string (e.g. the Liara console WebSocket URL). */
export function scrubString(s: string): string {
  return s.replace(URL_TOKEN_RE, `$1${REDACTED}`);
}

function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return value;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Error)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? REDACTED : scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface CreateLoggerOptions {
  level?: string;
  name?: string;
  destination?: DestinationStream;
}

export function createLogger(opts: CreateLoggerOptions = {}): Logger {
  const options: LoggerOptions = {
    level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    formatters: {
      log: (obj) => scrubDeep(obj) as Record<string, unknown>,
    },
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? scrubString(a) : a));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  };
  if (opts.name) options.name = opts.name;
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

export const logger: Logger = createLogger();
