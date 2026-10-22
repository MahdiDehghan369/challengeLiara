import { z } from 'zod';
import { LiaraApiError } from '../../shared/errors.js';
import type { LiaraHttp } from '../http.js';
import type { AppsApi } from './apps.js';
import { AcceptedSchema } from './schemas/apps.js';

export const FixedIpResponseSchema = z.object({ IP: z.string().optional() }).passthrough();

export type SettingName = 'zero-downtime' | 'default-subdomain' | 'fixed-ip' | 'read-only';

export interface SettingResult {
  accepted: true;
  /** 409 from Liara: the setting already had the requested status. */
  alreadyInState: boolean;
}

const enc = encodeURIComponent;

/**
 * App settings. Every route takes `{id}` (resolved from the app name via `resolveApp`) and a
 * `{status}` of `enable` / `disable`. A 409 means "already in that state" and counts as success.
 */
export class SettingsApi {
  constructor(
    private readonly http: LiaraHttp,
    private readonly apps: AppsApi,
  ) {}

  private async post<S extends z.ZodTypeAny>(
    name: string,
    setting: SettingName,
    on: boolean,
    schema: S,
  ): Promise<{ body: z.infer<S> | undefined; alreadyInState: boolean }> {
    const { id } = await this.apps.resolveApp(name);
    const status = on ? 'enable' : 'disable';
    try {
      const body = await this.http.post(`/v1/projects/${enc(id)}/${setting}/${status}`, {
        schema,
        operationId: `settings.${setting}`,
      });
      return { body: body as z.infer<S>, alreadyInState: false };
    } catch (e) {
      if (e instanceof LiaraApiError && e.status === 409) return { body: undefined, alreadyInState: true };
      throw e;
    }
  }

  /** `POST /v1/projects/{id}/zero-downtime/{status}`. */
  async setZeroDowntime(name: string, on: boolean): Promise<SettingResult> {
    const r = await this.post(name, 'zero-downtime', on, AcceptedSchema);
    return { accepted: true, alreadyInState: r.alreadyInState };
  }

  /** `POST /v1/projects/{id}/default-subdomain/{status}`. */
  async setDefaultSubdomain(name: string, on: boolean): Promise<SettingResult> {
    const r = await this.post(name, 'default-subdomain', on, AcceptedSchema);
    return { accepted: true, alreadyInState: r.alreadyInState };
  }

  /** `POST /v1/projects/{id}/fixed-ip/{status}` → `{IP}` (absent on 409 or when disabling). Costs money (R2). */
  async setFixedIp(name: string, on: boolean): Promise<SettingResult & { ip: string | undefined }> {
    const r = await this.post(name, 'fixed-ip', on, FixedIpResponseSchema);
    return { accepted: true, alreadyInState: r.alreadyInState, ip: r.body?.IP };
  }

  /** `POST /v1/projects/{id}/read-only/{status}`. */
  async setReadOnly(name: string, on: boolean): Promise<SettingResult> {
    const r = await this.post(name, 'read-only', on, AcceptedSchema);
    return { accepted: true, alreadyInState: r.alreadyInState };
  }
}
