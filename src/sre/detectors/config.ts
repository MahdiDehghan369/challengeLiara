import { logSignal } from './helpers.js';
import type { Detector } from './types.js';

/** Configuration detectors (T7.5): missing-env, db-connection, module-not-found. */

const MISSING_ENV_RE = new RegExp(
  [
    String.raw`Missing required env(?:ironment)? (?:var(?:iable)?)?:?\s*([A-Z_][A-Z0-9_]*)?`,
    String.raw`KeyError: '([A-Z_][A-Z0-9_]*)'`,
    String.raw`environment variable "?([A-Z_][A-Z0-9_]*)"? (?:is )?(?:not set|missing|required|undefined)`,
    String.raw`([A-Z_][A-Z0-9_]*) (?:is not defined|is required) in (?:the )?env`,
    String.raw`ERR_INVALID_URL|Invalid URL|TypeError: Invalid URL`,
  ].join('|'),
  'i',
);

export const missingEnv: Detector = (s) => {
  const out = logSignal('missing-env', 'critical', s, MISSING_ENV_RE);
  // `logSignal` keeps only the first capture group; look through all groups for the variable name
  for (const sig of out) {
    const text = sig.evidence.logRefs?.map((r) => r.snippet).join('\n') ?? '';
    const m = MISSING_ENV_RE.exec(text);
    const name = m?.slice(1).find((g) => g !== undefined);
    if (name) sig.detail = name;
    else delete sig.detail;
  }
  return out;
};

export const dbConnection: Detector = (s) =>
  logSignal(
    'db-connection',
    'critical',
    s,
    /((?:ECONNREFUSED|ETIMEDOUT)[^\n]*:(?:5432|3306|27017|6379)\b|password authentication failed[^\n]*|too many connections|Access denied for user[^\n]*|SequelizeConnection\w*Error|PrismaClientInitializationError|MongoServerSelectionError|could not connect to server)/i,
  );

export const moduleNotFound: Detector = (s) =>
  logSignal('module-not-found', 'critical', s, /(?:Cannot find module '([^']+)'|MODULE_NOT_FOUND|ModuleNotFoundError: No module named '([^']+)'|No module named '?([\w.]+)'?)/);
