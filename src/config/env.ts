import dotenv from 'dotenv';
import { z } from 'zod';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const EnvSchema = z.object({
  LIARA_API_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  LIARA_TEAM_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  LIARA_MODE: z.preprocess(emptyToUndefined, z.enum(['live', 'mock']).default('mock')),
  BOXAPI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  LLM_MODE: z.preprocess(emptyToUndefined, z.enum(['live', 'mock']).default('mock')),
  SIAVASH_DATA_DIR: z.preprocess(emptyToUndefined, z.string().default('.siavash')),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
  DEPLOY_MODE: z.preprocess(emptyToUndefined, z.enum(['cli', 'api']).default('cli')),
});

export interface Config {
  liara: { token: string | undefined; teamId: string | undefined; mode: 'live' | 'mock' };
  llm: { apiKey: string | undefined; mode: 'live' | 'mock' };
  dataDir: string;
  logLevel: z.infer<typeof EnvSchema>['LOG_LEVEL'];
  deployMode: 'cli' | 'api';
}

function deepFreeze<T extends object>(o: T): Readonly<T> {
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') deepFreeze(v as object);
  }
  return Object.freeze(o);
}

/** Pure: validates an env map and returns a frozen config. Throws ValidationError with a Persian message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Readonly<Config> {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ValidationError('Invalid environment configuration', {
      messageFa: fa.config.invalidEnv,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  const e = parsed.data;
  if (e.LIARA_MODE === 'live' && !e.LIARA_API_TOKEN) {
    throw new ValidationError('LIARA_API_TOKEN is required when LIARA_MODE=live', {
      messageFa: fa.config.missingLiaraToken,
    });
  }
  if (e.LLM_MODE === 'live' && !e.BOXAPI_API_KEY) {
    throw new ValidationError('BOXAPI_API_KEY is required when LLM_MODE=live', {
      messageFa: fa.config.missingBoxApiKey,
    });
  }
  return deepFreeze({
    liara: { token: e.LIARA_API_TOKEN, teamId: e.LIARA_TEAM_ID, mode: e.LIARA_MODE },
    llm: { apiKey: e.BOXAPI_API_KEY, mode: e.LLM_MODE },
    dataDir: e.SIAVASH_DATA_DIR,
    logLevel: e.LOG_LEVEL,
    deployMode: e.DEPLOY_MODE,
  });
}

let cached: Readonly<Config> | undefined;

/** Loads `.env` (without overriding already-set variables) and returns the memoized config. */
export function getConfig(): Readonly<Config> {
  if (!cached) {
    dotenv.config({ quiet: true });
    cached = loadConfig(process.env);
  }
  return cached;
}
