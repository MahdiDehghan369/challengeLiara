import { z } from 'zod';
import { ValidationError } from '../../shared/errors.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { LiaraHttp } from '../http.js';

// specs/billing.yaml + recorded fixture (T0.5, OQ-4): `{user:{...}, team?:{...}}`.
const money = z.union([z.number(), z.string()]);
const BillingPartySchema = z
  .object({
    balance: money,
    accountType: z.string().optional(),
    minCreditAmount: money.optional(),
    isManualMinCredit: z.boolean().optional(),
    minCreditLastNotifiedAt: z.string().nullish(),
  })
  .passthrough();

export const BillingResponseSchema = z.object({
  user: BillingPartySchema,
  team: BillingPartySchema.nullish(),
});

export interface Billing {
  /** Always a finite number, in Toman (per the map, 04-LIARA_API_MAP "Billing"). */
  balanceToman: number;
  accountType: string | undefined;
  /** Liara warns when the balance falls below this (Toman). */
  minCreditThreshold: number | undefined;
  /** Derived: a positive threshold means low-balance alerts are active. */
  alertEnabled: boolean;
  /** The threshold was set by the user rather than by Liara's default. */
  manualThreshold: boolean | undefined;
  lastNotifiedAt: string | undefined;
  /** Whose balance this is (team when the token works in a team context). */
  scope: 'team' | 'user';
}

function toNumber(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[,\s]/g, '')) : NaN;
  if (!Number.isFinite(n)) {
    throw new ValidationError(`billing: ${field} is not a number`, {
      messageFa: fa.liaraHttp.unexpected,
      details: { field },
    });
  }
  return n;
}

export class BillingApi {
  constructor(private readonly http: LiaraHttp) {}

  /** `GET /v1/billing` → normalized; prefers the team's balance when present. */
  async getBilling(opts: { scope?: 'team' | 'user' } = {}): Promise<Billing> {
    const r = await this.http.get('/v1/billing', { schema: BillingResponseSchema, operationId: 'billing' });
    const scope = opts.scope ?? (r.team ? 'team' : 'user');
    const p = scope === 'team' && r.team ? r.team : r.user;
    const threshold = p.minCreditAmount === undefined ? undefined : toNumber(p.minCreditAmount, 'minCreditAmount');
    return {
      balanceToman: toNumber(p.balance, 'balance'),
      accountType: p.accountType,
      minCreditThreshold: threshold,
      alertEnabled: threshold !== undefined && threshold > 0,
      manualThreshold: p.isManualMinCredit,
      lastNotifiedAt: p.minCreditLastNotifiedAt ?? undefined,
      scope: scope === 'team' && r.team ? 'team' : 'user',
    };
  }
}
