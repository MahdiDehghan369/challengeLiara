import { LiaraApiError } from '../../shared/errors.js';
import type { AppsApi } from './apps.js';

export interface AccountInfo {
  tokenValid: boolean;
  /** Number of apps visible to the token (team scope when LIARA_TEAM_ID is set). */
  appCount: number | undefined;
}

/**
 * Account checks. The "me" endpoint exists only in specs/me.yaml (spec-only, D-006) and returns storage
 * secret keys, so the token is validated with the projects list instead. TODO(OQ-28): adopt the "me"
 * endpoint (without its secrets) once T0.8 confirms it.
 */
export class AccountApi {
  constructor(private readonly apps: Pick<AppsApi, 'listApps'>) {}

  async getMe(): Promise<AccountInfo> {
    try {
      const apps = await this.apps.listApps({ fresh: true });
      return { tokenValid: true, appCount: apps.length };
    } catch (e) {
      if (e instanceof LiaraApiError && (e.status === 401 || e.status === 403)) {
        return { tokenValid: false, appCount: undefined };
      }
      throw e;
    }
  }
}
