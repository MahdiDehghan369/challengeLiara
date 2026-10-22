import { Secret } from '../shared/secret.js';

/**
 * Parsers for Liara CLI text/JSON output.
 * TODO(OQ-16): the deploy-stage patterns below are conservative placeholders until the T0.8 spike
 * records real `liara deploy` output (BEHAVIOR §5). Only progress display depends on them — the
 * process exit code remains the source of truth for success/failure.
 */

export type DeployStage = 'upload' | 'build' | 'push' | 'release' | 'done' | 'failed';

export interface DeployLineInfo {
  stage?: DeployStage;
  version?: string;
  percent?: number;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const STAGE_PATTERNS: Array<[DeployStage, RegExp]> = [
  ['failed', /\b(build failed|deploy(?:ment)? failed|error:)/i],
  ['done', /\b(deployed successfully|deployment (?:finished|completed)|successfully deployed)\b/i],
  ['release', /\b(creating release|releasing|release created)\b/i],
  ['push', /\b(pushing|push(?:ed)? image)\b/i],
  ['build', /\b(building|build started|step \d+\/\d+)\b/i],
  ['upload', /\b(uploading|compressing|upload(?:ed)?)\b/i],
];

export function parseDeployLine(raw: string): DeployLineInfo {
  const line = stripAnsi(raw);
  const info: DeployLineInfo = {};
  for (const [stage, re] of STAGE_PATTERNS) {
    if (re.test(line)) {
      info.stage = stage;
      break;
    }
  }
  const v = /\b(?:release|version)\b[^\n]*?\b(v\d+)\b/i.exec(line) ?? /\b(v\d+)\b(?=.*\b(?:release|deployed)\b)/i.exec(line);
  if (v) info.version = v[1];
  const pct = /(\d{1,3})\s?%/.exec(line);
  if (pct && Number(pct[1]) <= 100) info.percent = Number(pct[1]);
  return info;
}

export interface EnvVar {
  key: string;
  value: Secret<string>;
}

/**
 * Parses `liara env:list --output json`. TODO(OQ-17): exact shape unrecorded; accepts
 * `[{key,value}]`, `[{name,value}]`, `{envs:[...]}`, `{variables:[...]}` or a `{KEY: value}` map.
 * Values are wrapped in Secret immediately.
 */
export function parseEnvListJson(json: unknown): EnvVar[] {
  const wrap = (key: unknown, value: unknown): EnvVar | undefined =>
    typeof key === 'string' && key !== '' ? { key, value: new Secret(value === undefined || value === null ? '' : String(value)) } : undefined;

  let list: unknown = json;
  if (list && typeof list === 'object' && !Array.isArray(list)) {
    const o = list as Record<string, unknown>;
    if (Array.isArray(o.envs)) list = o.envs;
    else if (Array.isArray(o.variables)) list = o.variables;
    else if (Array.isArray(o.data)) list = o.data;
    else {
      return Object.entries(o)
        .map(([k, v]) => wrap(k, v))
        .filter((e): e is EnvVar => e !== undefined);
    }
  }
  if (!Array.isArray(list)) throw new Error('env:list: unexpected JSON shape');
  return list
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const r = item as Record<string, unknown>;
      return wrap(r.key ?? r.name ?? r.KEY, r.value ?? r.VALUE);
    })
    .filter((e): e is EnvVar => e !== undefined);
}

/** Extracts the JSON document from CLI stdout that may contain banners/warnings around it. */
export function extractJson(stdout: string): unknown {
  const text = stripAnsi(stdout).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{]/);
    if (start < 0) throw new Error('no JSON in CLI output');
    const open = text[start] as string;
    const close = open === '[' ? ']' : '}';
    const end = text.lastIndexOf(close);
    return JSON.parse(text.slice(start, end + 1));
  }
}
