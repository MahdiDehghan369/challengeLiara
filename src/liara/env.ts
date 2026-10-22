import { z } from 'zod';
import { logger } from '../shared/logger.js';
import { Secret } from '../shared/secret.js';
import type { LiaraHttp } from './http.js';
import type { EnvVar } from './cli-parsers.js';

/**
 * Semantics of `POST /v1/projects/update-envs`. TODO(OQ-19): unconfirmed (BEHAVIOR §2 / G3).
 * 'unknown' is treated like 'replace' for writes (read all → merge → send all) so no variable is ever lost.
 */
export type EnvSemantics = 'replace' | 'merge' | 'unknown';

export type EnvChange = 'added' | 'changed' | 'removed';

export interface EnvChangeResult {
  before: EnvVar[];
  after: EnvVar[];
  diff: Array<{ key: string; change: EnvChange }>;
  /** Whether Liara restarts the app on env change. TODO(OQ-19): 'unknown' until the spike answers it. */
  restartsApp: boolean | 'unknown';
}

/** The CLI surface the env module needs (implemented by LiaraCli). */
export interface EnvCli {
  envList(app: string): Promise<EnvVar[]>;
  envUnset(app: string, keys: string[]): Promise<void>;
}

export interface EnvApiOptions {
  semantics?: EnvSemantics;
  restartsApp?: boolean | 'unknown';
}

const UpdateEnvsResponseSchema = z.object({ message: z.string().optional() }).passthrough();

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidEnvKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function diffEnv(before: EnvVar[], after: EnvVar[]): Array<{ key: string; change: EnvChange }> {
  const b = new Map(before.map((e) => [e.key, e.value.reveal()]));
  const a = new Map(after.map((e) => [e.key, e.value.reveal()]));
  const out: Array<{ key: string; change: EnvChange }> = [];
  for (const [k, v] of a) {
    if (!b.has(k)) out.push({ key: k, change: 'added' });
    else if (b.get(k) !== v) out.push({ key: k, change: 'changed' });
  }
  for (const k of b.keys()) if (!a.has(k)) out.push({ key: k, change: 'removed' });
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

const toSecret = (v: string | Secret<string>) => (v instanceof Secret ? v : new Secret(v));

/** Env: read via CLI (no REST read endpoint, G2), write via `update-envs`, safe merge. */
export class EnvApi {
  private readonly semantics: EnvSemantics;
  private readonly restartsApp: boolean | 'unknown';

  constructor(
    private readonly http: LiaraHttp,
    private readonly cli: EnvCli,
    opts: EnvApiOptions = {},
  ) {
    this.semantics = opts.semantics ?? 'unknown';
    this.restartsApp = opts.restartsApp ?? 'unknown';
  }

  /** `liara env:list -a <app> --output json` → values as Secret. */
  listEnv(app: string): Promise<EnvVar[]> {
    return this.cli.envList(app);
  }

  private async post(app: string, vars: EnvVar[]): Promise<void> {
    logger.debug({ app, keys: vars.map((v) => v.key) }, 'update-envs');
    await this.http.post('/v1/projects/update-envs', {
      body: { project: app, variables: vars.map((v) => ({ key: v.key, value: v.value.reveal() })) },
      schema: UpdateEnvsResponseSchema,
      operationId: 'env.update',
    });
  }

  /** Sets/overwrites variables. In replace/unknown mode the full merged set is sent. */
  async setEnv(app: string, vars: Record<string, string | Secret<string>>): Promise<EnvChangeResult> {
    for (const k of Object.keys(vars)) {
      if (!isValidEnvKey(k)) throw new Error(`invalid env key: ${k}`);
    }
    const before = await this.listEnv(app);
    const incoming: EnvVar[] = Object.entries(vars).map(([key, v]) => ({ key, value: toSecret(v) }));
    if (this.semantics === 'merge') {
      await this.post(app, incoming);
    } else {
      const merged = new Map(before.map((e) => [e.key, e]));
      for (const e of incoming) merged.set(e.key, e);
      await this.post(app, [...merged.values()]);
    }
    return this.result(app, before);
  }

  /**
   * Removes variables. replace → send the list without them; merge or unknown → `liara env:unset`
   * (correct under either semantics, whereas "send without" would silently do nothing under merge).
   */
  async unsetEnv(app: string, keys: string[]): Promise<EnvChangeResult> {
    const before = await this.listEnv(app);
    const drop = new Set(keys);
    if (this.semantics === 'replace') {
      await this.post(
        app,
        before.filter((e) => !drop.has(e.key)),
      );
    } else {
      await this.cli.envUnset(app, keys);
    }
    return this.result(app, before);
  }

  private async result(app: string, before: EnvVar[]): Promise<EnvChangeResult> {
    const after = await this.listEnv(app);
    return { before, after, diff: diffEnv(before, after), restartsApp: this.restartsApp };
  }
}
