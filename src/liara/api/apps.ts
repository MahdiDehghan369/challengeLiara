import { LiaraApiError } from '../../shared/errors.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Accepted, LiaraHttp } from '../http.js';
import {
  AcceptedSchema,
  CreateAppInputSchema,
  ProjectsResponseSchema,
  toApp,
  type App,
  type CreateAppInput,
} from './schemas/apps.js';

export const APP_CACHE_TTL_MS = 5_000;

export function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

/** Closest candidate within a sensible edit distance, or undefined. */
export function closestName(name: string, candidates: string[]): string | undefined {
  let best: { n: string; d: number } | undefined;
  for (const c of candidates) {
    const d = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (!best || d < best.d) best = { n: c, d };
  }
  if (!best) return undefined;
  return best.d <= Math.max(2, Math.floor(name.length / 3)) ? best.n : undefined;
}

export interface AppsApiOptions {
  cacheTtlMs?: number;
  now?: () => number;
}

/**
 * Apps module. There is no app-details endpoint in the map (G1), so get/resolve filter the list.
 * `{name}` endpoints take `project_id`; `{id}` endpoints must use `resolveApp(name).id`.
 */
export class AppsApi {
  private cache: { at: number; apps: App[] } | undefined;
  private readonly ttl: number;
  private readonly now: () => number;

  constructor(
    private readonly http: LiaraHttp,
    opts: AppsApiOptions = {},
  ) {
    this.ttl = opts.cacheTtlMs ?? APP_CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  /** `GET /v1/projects`. `fresh` bypasses the 5s cache (used by waiters). */
  async listApps(opts: { fresh?: boolean } = {}): Promise<App[]> {
    if (!opts.fresh && this.cache && this.now() - this.cache.at < this.ttl) return this.cache.apps;
    const res = await this.http.get('/v1/projects', { schema: ProjectsResponseSchema, operationId: 'apps.list' });
    const apps = res.projects.map(toApp);
    this.cache = { at: this.now(), apps };
    return apps;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  async findApp(name: string, opts: { fresh?: boolean } = {}): Promise<App | undefined> {
    return (await this.listApps(opts)).find((a) => a.name === name);
  }

  /** Throws `LiaraApiError('APP_NOT_FOUND')` with the closest existing name as a suggestion. */
  async getApp(name: string, opts: { fresh?: boolean } = {}): Promise<App> {
    const apps = await this.listApps(opts);
    const app = apps.find((a) => a.name === name);
    if (app) return app;
    const suggestion = closestName(
      name,
      apps.map((a) => a.name),
    );
    throw new LiaraApiError(`App not found: ${name}`, {
      code: 'APP_NOT_FOUND',
      status: 404,
      operationId: 'apps.get',
      messageFa: suggestion ? fa.apps.notFoundSuggest(name, suggestion) : fa.apps.notFound(name),
      details: { name, ...(suggestion ? { suggestion } : {}) },
    });
  }

  async resolveApp(name: string): Promise<{ id: string; name: string }> {
    const app = await this.getApp(name);
    return { id: app.id, name: app.name };
  }

  /** `POST /v1/projects`. 409 → `APP_NAME_TAKEN`. */
  async createApp(input: CreateAppInput): Promise<Accepted> {
    const body = CreateAppInputSchema.parse(input);
    try {
      await this.http.post('/v1/projects', { body, schema: AcceptedSchema, operationId: 'apps.create' });
    } catch (e) {
      if (e instanceof LiaraApiError && e.status === 409) {
        throw new LiaraApiError(`App name taken: ${input.name}`, {
          code: 'APP_NAME_TAKEN',
          status: 409,
          operationId: 'apps.create',
          messageFa: fa.apps.nameTaken(input.name),
          details: { name: input.name },
          cause: e,
        });
      }
      throw e;
    } finally {
      this.invalidate();
    }
    return { accepted: true };
  }

  /** `DELETE /v1/projects/{name}` — async; confirm with `waitAppGone`. */
  async deleteApp(name: string): Promise<Accepted> {
    return this.mutate(`/v1/projects/${encodeURIComponent(name)}`, 'DELETE', undefined, 'apps.delete');
  }

  /** `POST /v1/projects/{name}/actions/scale` — async; confirm with `waitAppScale`. */
  async setScale(name: string, scale: 0 | 1): Promise<Accepted> {
    return this.mutate(`/v1/projects/${encodeURIComponent(name)}/actions/scale`, 'POST', { scale }, 'apps.scale');
  }

  /** `POST /v1/projects/{name}/actions/restart` — async; confirm with `waitAppRunning`. */
  async restartApp(name: string): Promise<Accepted> {
    return this.mutate(`/v1/projects/${encodeURIComponent(name)}/actions/restart`, 'POST', undefined, 'apps.restart');
  }

  /** `POST /v1/projects/{name}/resize`. */
  async resizeApp(name: string, planID: string): Promise<Accepted> {
    return this.mutate(`/v1/projects/${encodeURIComponent(name)}/resize`, 'POST', { planID }, 'apps.resize');
  }

  private async mutate(path: string, method: 'POST' | 'DELETE', body: unknown, operationId: string): Promise<Accepted> {
    try {
      const opts = { schema: AcceptedSchema, operationId, ...(body === undefined ? {} : { body }) };
      await (method === 'POST' ? this.http.post(path, opts) : this.http.delete(path, opts));
      return { accepted: true };
    } finally {
      this.invalidate();
    }
  }
}
