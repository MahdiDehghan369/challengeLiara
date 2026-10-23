import { ExternalCommandError, isSiavashError, ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';

/**
 * Liara plan catalog (T4.6), built from `liara plan:list --output json` (recorded shape, OQ-5):
 * rows of strings `{Plan, RAM, CPU, Disk, Price, Free, Standard, Pro}`, prices with thousands commas.
 * Never falls back to a made-up catalog: if the CLI fails, callers get a clear error.
 */

export type PlanKind = 'app' | 'db' | 'disk';
export type Bundle = 'free' | 'standard' | 'pro';

export interface PlanEntry {
  id: string;
  kind: PlanKind;
  cpu: number;
  ramMb: number;
  diskGb: number;
  /**
   * The `Price` column. TODO(OQ-5): currency (Toman vs Rial) and whether it already includes the
   * feature bundle are unconfirmed; it tracks the Pro column closely in the recorded fixture.
   */
  priceMonthlyToman: number;
  /** Not reported by plan:list; left undefined rather than derived. */
  priceHourlyToman?: number;
  /** Per feature-bundle monthly prices (`Free` / `Standard` / `Pro` columns), when present. */
  bundlePricesToman: Partial<Record<Bundle, number>>;
  /** plan:list has no availability flag; every listed plan is treated as available. */
  available: boolean;
}

export interface PlanListSource {
  planList(): Promise<unknown>;
}

export const PLAN_CACHE_TTL_MS = 10 * 60_000;

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Parses plan:list rows; rows missing a name, RAM, CPU or price are dropped. Sorted by price. */
export function parsePlanList(raw: unknown): PlanEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: PlanEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.Plan === 'string' ? r.Plan.trim() : '';
    const ramGb = num(r.RAM);
    const cpu = num(r.CPU);
    const price = num(r.Price);
    if (!id || ramGb === undefined || cpu === undefined || price === undefined) continue;
    const bundlePricesToman: Partial<Record<Bundle, number>> = {};
    for (const [col, b] of [['Free', 'free'], ['Standard', 'standard'], ['Pro', 'pro']] as const) {
      const v = num(r[col]);
      if (v !== undefined) bundlePricesToman[b] = v;
    }
    out.push({
      id,
      kind: 'app',
      cpu,
      ramMb: Math.round(ramGb * 1024),
      diskGb: num(r.Disk) ?? 0,
      priceMonthlyToman: price,
      bundlePricesToman,
      available: true,
    });
  }
  return out.sort((a, b) => a.priceMonthlyToman - b.priceMonthlyToman || a.ramMb - b.ramMb);
}

export class PlanCatalog {
  private cache: { at: number; plans: PlanEntry[] } | undefined;

  constructor(
    private readonly source: PlanListSource,
    private readonly opts: { ttlMs?: number; now?: () => number } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  async list(opts: { fresh?: boolean } = {}): Promise<PlanEntry[]> {
    const ttl = this.opts.ttlMs ?? PLAN_CACHE_TTL_MS;
    if (!opts.fresh && this.cache && this.now() - this.cache.at < ttl) return this.cache.plans;
    let raw: unknown;
    try {
      raw = await this.source.planList();
    } catch (cause) {
      throw new ExternalCommandError('liara plan:list failed', {
        messageFa: fa.planner.catalogUnavailable,
        details: isSiavashError(cause) ? { cause: cause.code } : {},
        cause,
        retryable: true,
      });
    }
    const plans = parsePlanList(raw);
    if (plans.length === 0) throw new ValidationError('liara plan:list returned no usable plans', { messageFa: fa.planner.catalogEmpty });
    this.cache = { at: this.now(), plans };
    return plans;
  }

  /** Maps an app's `planID` to its resources (used by SRE for usage percentages). */
  async planById(planId: string): Promise<PlanEntry | undefined> {
    return (await this.list()).find((p) => p.id === planId);
  }

  async requirePlan(planId: string): Promise<PlanEntry> {
    const p = await this.planById(planId);
    if (!p) throw new ValidationError(`unknown plan ${planId}`, { messageFa: fa.planner.unknownPlan(planId), details: { planId } });
    return p;
  }
}
