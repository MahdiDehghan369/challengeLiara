import { fa } from '../ui/cli/i18n/fa.js';
import type { Bundle, PlanCatalog, PlanEntry } from './plans.js';

/**
 * Monthly cost estimate (T4.6) for app + database + disk. Only the app plan has a known price source
 * (plan:list); database and disk prices are reported as unknown instead of guessed (TODO(OQ-29)).
 */

export interface CostSelection {
  appPlanId: string;
  /** Feature bundle; uses that column when present, otherwise the plan's `Price`. */
  bundle?: Bundle;
  db?: { planId: string };
  diskGb?: number;
}

export interface CostItem {
  kind: 'app' | 'db' | 'disk';
  id: string;
  monthlyToman?: number;
  noteFa?: string;
}

export interface CostEstimate {
  items: CostItem[];
  /** Sum of the items with a known price. */
  totalMonthlyToman: number;
  /** False when any item's price is unknown (the total is then a lower bound). */
  complete: boolean;
}

export const BALANCE_FACTOR = 1.2;

/** Balance needed before creating/resizing: monthly × 1.2, never below Liara's minimum-credit threshold. */
export function requiredBalance(monthlyToman: number, minCreditThreshold = 0): number {
  return Math.max(Math.ceil(monthlyToman * BALANCE_FACTOR), minCreditThreshold);
}

export function appMonthlyPrice(plan: PlanEntry, bundle?: Bundle): number {
  const b = bundle ? plan.bundlePricesToman[bundle] : undefined;
  return b !== undefined && b > 0 ? b : plan.priceMonthlyToman;
}

export async function estimateCost(catalog: PlanCatalog, sel: CostSelection): Promise<CostEstimate> {
  const app = await catalog.requirePlan(sel.appPlanId);
  const items: CostItem[] = [{ kind: 'app', id: app.id, monthlyToman: appMonthlyPrice(app, sel.bundle) }];
  if (sel.db) items.push({ kind: 'db', id: sel.db.planId, noteFa: fa.planner.priceUnknown(fa.planner.dbLabel) });
  if (sel.diskGb !== undefined && sel.diskGb > 0) {
    items.push({ kind: 'disk', id: `${sel.diskGb}GB`, noteFa: fa.planner.priceUnknown(fa.planner.diskLabel) });
  }
  return {
    items,
    totalMonthlyToman: items.reduce((s, i) => s + (i.monthlyToman ?? 0), 0),
    complete: items.every((i) => i.monthlyToman !== undefined),
  };
}
