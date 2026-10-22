import { isSecretEnvName } from '../safety/risk.js';
import { Secret } from '../shared/secret.js';
import { listFiles, readText } from './project-files.js';

export interface EnvVarFinding {
  name: string;
  /** e.g. `.env.example`, `index.js:12`. */
  sources: string[];
  hasDefault: boolean;
  /** No default and needed at startup (or left empty in .env.example). */
  required: boolean;
  isSecret: boolean;
  /** Non-secret example value from .env.example, if any. */
  suggestedValue?: string;
  /** PORT / NODE_ENV: set by the agent, not asked from the user. */
  managedByAgent: boolean;
}

export interface EnvDetection {
  vars: EnvVarFinding[];
  /** Values of the user's real `.env`, only when explicitly allowed. */
  dotenv?: Map<string, Secret<string>>;
}

export const AGENT_MANAGED_ENV = new Set(['PORT', 'NODE_ENV']);

const EXAMPLE_FILES = ['.env.example', '.env.sample', '.env.dist', '.env.template'];
const CODE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.php', '.go', '.vue', '.svelte'];
const ENTRY_RE = /(^|\/)(index|main|server|app|manage|settings|wsgi|asgi|config\/[\w-]+)\.\w+$/;

interface Usage {
  name: string;
  hasDefault: boolean;
  /** Raises the "required" signal (startup usage or a hard lookup). */
  startup: boolean;
  where: string;
}

/** Usage patterns: [regex, hasDefault(match), hardLookup]. Group 1 is the variable name. */
const PATTERNS: Array<{ re: RegExp; def: (m: RegExpExecArray) => boolean; hard?: boolean }> = [
  // process.env.X  ||  ?? default
  { re: /process\.env\.([A-Z_][A-Z0-9_]*)(\s*(?:\|\||\?\?))?/g, def: (m) => !!m[2] },
  { re: /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\](\s*(?:\|\||\?\?))?/g, def: (m) => !!m[2] },
  { re: /import\.meta\.env\.([A-Z_][A-Z0-9_]*)(\s*(?:\|\||\?\?))?/g, def: (m) => !!m[2] },
  // os.environ["X"] → KeyError if missing
  { re: /os\.environ\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g, def: () => false, hard: true },
  // os.environ.get("X", d) / os.getenv("X", d) / getenv('X') / env('X', d)
  { re: /os\.environ\.get\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*(,)?/g, def: (m) => !!m[2] },
  { re: /os\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*(,)?/g, def: (m) => !!m[2] },
  { re: /(?<![.\w])getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*(,)?/g, def: (m) => !!m[2] },
  { re: /(?<![.\w$])env\(\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*(,)?/g, def: (m) => !!m[2] },
  // Go
  { re: /os\.Getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g, def: () => false },
];

function scanCode(root: string): Usage[] {
  const out: Usage[] = [];
  for (const file of listFiles(root, { exts: CODE_EXTS, max: 1_500 })) {
    const text = readText(root, file);
    if (!text) continue;
    const isEntry = ENTRY_RE.test(file);
    text.split(/\r?\n/).forEach((line, i) => {
      const topLevel = !/^\s/.test(line);
      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        for (let m = p.re.exec(line); m; m = p.re.exec(line)) {
          out.push({
            name: m[1] as string,
            hasDefault: p.def(m),
            startup: !!p.hard || topLevel || isEntry,
            where: `${file}:${i + 1}`,
          });
        }
      }
    });
  }
  return out;
}

function parseDotenv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = (m[2] as string).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out.set(m[1] as string, v);
  }
  return out;
}

export interface DetectEnvOptions {
  /** Read the user's real `.env` (values returned as Secret). Only with explicit user permission. */
  readDotEnv?: boolean;
}

export function detectEnv(root: string, opts: DetectEnvOptions = {}): EnvDetection {
  const byName = new Map<string, { sources: Set<string>; hasDefault: boolean; startupNoDefault: boolean; example?: string; inExample: boolean }>();
  const get = (name: string) => {
    let e = byName.get(name);
    if (!e) {
      e = { sources: new Set(), hasDefault: false, startupNoDefault: false, inExample: false };
      byName.set(name, e);
    }
    return e;
  };

  for (const f of EXAMPLE_FILES) {
    const t = readText(root, f);
    if (t === undefined) continue;
    for (const [k, v] of parseDotenv(t)) {
      const e = get(k);
      e.sources.add(f);
      e.inExample = true;
      if (v !== '') e.example = v;
    }
  }

  for (const u of scanCode(root)) {
    const e = get(u.name);
    e.sources.add(u.where);
    if (u.hasDefault) e.hasDefault = true;
    else if (u.startup) e.startupNoDefault = true;
  }

  const vars: EnvVarFinding[] = [...byName.entries()]
    .map(([name, e]) => {
      const managedByAgent = AGENT_MANAGED_ENV.has(name);
      const isSecret = isSecretEnvName(name);
      const required =
        !managedByAgent && !e.hasDefault && (e.startupNoDefault || (e.inExample && e.example === undefined));
      const v: EnvVarFinding = {
        name,
        sources: [...e.sources].sort(),
        hasDefault: e.hasDefault,
        required,
        isSecret,
        managedByAgent,
      };
      if (e.example !== undefined && !isSecret) v.suggestedValue = e.example;
      return v;
    })
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));

  const result: EnvDetection = { vars };
  if (opts.readDotEnv) {
    const t = readText(root, '.env');
    if (t !== undefined) result.dotenv = new Map([...parseDotenv(t)].map(([k, v]) => [k, new Secret(v)]));
  }
  return result;
}
