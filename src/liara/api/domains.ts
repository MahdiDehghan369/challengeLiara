import { z } from 'zod';
import { LiaraApiError } from '../../shared/errors.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { Accepted, LiaraHttp } from '../http.js';
import type { AppsApi } from './apps.js';
import { AcceptedSchema } from './schemas/apps.js';

export const DomainSchema = z
  .object({
    _id: z.string(),
    name: z.string(),
    type: z.string().optional(),
    project: z.unknown().optional(),
    status: z.string().optional(),
    certificatesStatus: z.string().optional(),
    redirectTo: z.string().nullish(),
    redirectStatus: z.coerce.number().nullish(),
    created_at: z.string().optional(),
    CNameRecord: z.string().nullish(),
  })
  .passthrough();

export const DomainsListResponseSchema = z.object({ domains: z.array(DomainSchema).default([]) });
export const DomainCreateResponseSchema = z.object({ domain: z.object({ _id: z.string() }).passthrough() }).passthrough();
export const SslProvisionResponseSchema = z.object({ code: z.unknown().optional() }).passthrough();

export interface Domain {
  id: string;
  name: string;
  type: string | undefined;
  status: string | undefined;
  certificatesStatus: string | undefined;
  redirectTo: string | undefined;
  redirectStatus: number | undefined;
  createdAt: string | undefined;
  /** Target the user's CNAME should point to. */
  cnameRecord: string | undefined;
}

export type RedirectStatus = 301 | 302;

const enc = encodeURIComponent;

/** Domains and SSL exactly per the map (04-MAP "Domains / SSL"). */
export class DomainsApi {
  constructor(
    private readonly http: LiaraHttp,
    private readonly apps: AppsApi,
  ) {}

  /** `GET /v1/domains?project=<name>`. */
  async listDomains(app: string): Promise<Domain[]> {
    const r = await this.http.get('/v1/domains', {
      query: { project: app },
      schema: DomainsListResponseSchema,
      operationId: 'domains.list',
    });
    return r.domains.map((d) => ({
      id: d._id,
      name: d.name,
      type: d.type,
      status: d.status,
      certificatesStatus: d.certificatesStatus,
      redirectTo: d.redirectTo ?? undefined,
      redirectStatus: d.redirectStatus ?? undefined,
      createdAt: d.created_at,
      cnameRecord: d.CNameRecord ?? undefined,
    }));
  }

  /** `POST /v1/domains {name, project, type}` → 201 `{domain:{_id}}`; 409 → `DOMAIN_EXISTS`. */
  async createDomain(name: string, app: string, type = 'PROJECT'): Promise<{ id: string }> {
    try {
      const r = await this.http.post('/v1/domains', {
        body: { name, project: app, type },
        schema: DomainCreateResponseSchema,
        operationId: 'domains.create',
      });
      return { id: r.domain._id };
    } catch (e) {
      if (e instanceof LiaraApiError && e.status === 409) {
        throw new LiaraApiError(`Domain already exists: ${name}`, {
          code: 'DOMAIN_EXISTS',
          status: 409,
          operationId: 'domains.create',
          messageFa: fa.domains.exists(name),
          details: { name, app },
          cause: e,
        });
      }
      throw e;
    }
  }

  /** `POST /v1/domains/set-project {domainID, projectID}` (projectID is the app id). */
  async attachDomain(domainID: string, appId: string): Promise<Accepted> {
    await this.http.post('/v1/domains/set-project', {
      body: { domainID, projectID: appId },
      schema: AcceptedSchema,
      operationId: 'domains.setProject',
    });
    return { accepted: true };
  }

  /** Same as `attachDomain`, resolving the app id from its name. */
  async attachDomainToApp(domainID: string, app: string): Promise<Accepted> {
    return this.attachDomain(domainID, (await this.apps.resolveApp(app)).id);
  }

  /** `POST /v1/domains/{id}/set-redirect {redirectStatus, redirectTo}`. */
  async setRedirect(id: string, status: RedirectStatus, to: string): Promise<Accepted> {
    await this.http.post(`/v1/domains/${enc(id)}/set-redirect`, {
      body: { redirectStatus: status, redirectTo: to },
      schema: AcceptedSchema,
      operationId: 'domains.setRedirect',
    });
    return { accepted: true };
  }

  /** `POST /v1/domains/provision-ssl-certs {domain}` → `{code}`. */
  async enableSsl(domain: string): Promise<{ accepted: true; code: unknown }> {
    const r = await this.http.post('/v1/domains/provision-ssl-certs', {
      body: { domain },
      schema: SslProvisionResponseSchema,
      operationId: 'ssl.provision',
    });
    return { accepted: true, code: r.code };
  }

  /** `POST /v1/domains/{id}/ssl/disable` → 204. */
  async disableSsl(id: string): Promise<Accepted> {
    await this.http.post(`/v1/domains/${enc(id)}/ssl/disable`, { schema: AcceptedSchema, operationId: 'ssl.disable' });
    return { accepted: true };
  }

  /** `DELETE /v1/domains/{id}`. */
  async deleteDomain(id: string): Promise<Accepted> {
    await this.http.delete(`/v1/domains/${enc(id)}`, { schema: AcceptedSchema, operationId: 'domains.delete' });
    return { accepted: true };
  }
}
