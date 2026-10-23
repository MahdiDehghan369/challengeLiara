import type { Platform } from '../analyzer/platform-map.js';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { appMonthlyPrice } from './cost.js';
import type { Bundle, PlanCatalog, PlanEntry } from './plans.js';

/**
 * Plan recommender (T4.7). Deterministic rules only: platform minimum RAM, project size, goal and
 * expected traffic → three options (economy / recommended / performance), each from available plans.
 * `recommendUpgrade` picks the next plan for SRE when observed usage is high.
 */

export type Goal = 'test' | 'production';
export type Traffic = 'low' | 'medium' | 'high';
export type Tier = 'economy' | 'recommended' | 'performance';

/** Our sizing rules (not Liara facts): smallest RAM a typical app of this platform runs in. */
export const MIN_RAM_MB: Record<Platform, number> = {
  static: 512,
  'react-static': 512,
  node: 512,
  go: 512,
  flask: 512,
  fastapi: 512,
  django: 1024,
  laravel: 1024,
  next: 1024,
  docker: 1024,
  unknown: 1024,
};

const LARGE_PROJECT_MB = 300;
export const UPGRADE_THRESHOLD_PCT = 80;

export interface RecommendInput {
  platform: Platform;
  sizeMb?: number;
  goal?: Goal;
  traffic?: Traffic;
  bundle?: Bundle;
}

export interface PlanOption {
  tier: Tier;
  plan: PlanEntry;
  monthlyToman: number;
  reasonFa: string;
}

export interface Recommendation {
  neededRamMb: number;
  options: PlanOption[];
}

/** RAM the rules ask for, in MB. */
export function neededRamMb(input: RecommendInput): number {
  let ram = MIN_RAM_MB[input.platform];
  if ((input.sizeMb ?? 0) > LARGE_PROJECT_MB) ram = Math.max(ram, 1024);
  if (input.goal === 'production') ram = Math.max(ram * 2, 1024);
  if (input.traffic === 'medium') ram *= 2;
  if (input.traffic === 'high') ram *= 4;
  return ram;
}

function whyFa(input: RecommendInput): string {
  const parts: string[] = [];
  if ((input.sizeMb ?? 0) > LARGE_PROJECT_MB) parts.push(fa.planner.whyLargeProject);
  if (input.goal === 'production') parts.push(fa.planner.whyGoalProduction);
  if (input.traffic && input.traffic !== 'low') parts.push(fa.planner.whyTraffic(input.traffic));
  return parts.length > 0 ? parts.join(' ') : fa.planner.whyBase;
}

/** Plans sorted by price that fit the project on disk (twice its size, at least 1 GB). */
function candidates(plans: PlanEntry[], sizeMb: number): PlanEntry[] {
  const diskGb = Math.max(1, Math.ceil((sizeMb * 2) / 1024));
  return plans.filter((p) => p.available && p.kind === 'app' && p.diskGb >= diskGb);
}

export async function recommendPlans(catalog: PlanCatalog, input: RecommendInput): Promise<Recommendation> {
  const all = candidates(await catalog.list(), input.sizeMb ?? 0);
  if (all.length === 0) throw new ValidationError('no available app plan', { messageFa: fa.planner.noAvailablePlan });
  const need = neededRamMb(input);
  const minimum = MIN_RAM_MB[input.platform];
  const top = all.reduce((a, b) => (b.ramMb > a.ramMb ? b : a));

  const recIdx = all.findIndex((p) => p.ramMb >= need);
  const recommended = recIdx >= 0 ? (all[recIdx] as PlanEntry) : top;
  const economy = all.find((p) => p.ramMb >= minimum) ?? recommended;
  const performance = all.find((p) => p.priceMonthlyToman > recommended.priceMonthlyToman && p.ramMb > recommended.ramMb) ?? recommended;

  const opt = (tier: Tier, plan: PlanEntry, reasonFa: string): PlanOption => ({
    tier,
    plan,
    monthlyToman: appMonthlyPrice(plan, input.bundle),
    reasonFa,
  });
  return {
    neededRamMb: need,
    options: [
      opt('economy', economy.priceMonthlyToman <= recommended.priceMonthlyToman ? economy : recommended, fa.planner.reasonEconomy(minimum)),
      opt('recommended', recommended, recIdx >= 0 ? fa.planner.reasonRecommended(need, whyFa(input)) : fa.planner.reasonTopPlan),
      opt('performance', performance, performance === recommended ? fa.planner.reasonTopPlan : fa.planner.reasonPerformance),
    ],
  };
}

/** Observed usage as a percentage of the current plan (0–100), e.g. p95 over the last day. */
export interface UsageStats {
  memoryPct?: number;
  cpuPct?: number;
}

export interface UpgradeAdvice {
  current: PlanEntry;
  next: PlanEntry | undefined;
  needed: boolean;
  reasonFa: string;
}

export async function recommendUpgrade(catalog: PlanCatalog, currentPlanId: string, stats: UsageStats): Promise<UpgradeAdvice> {
  const current = await catalog.requirePlan(currentPlanId);
  const memHigh = (stats.memoryPct ?? 0) >= UPGRADE_THRESHOLD_PCT;
  const cpuHigh = (stats.cpuPct ?? 0) >= UPGRADE_THRESHOLD_PCT;
  const fmt = (v: number | undefined) => (v === undefined ? fa.planner.unknownWord : fa.planner.pct(Math.round(v)));
  if (!memHigh && !cpuHigh) {
    return { current, next: undefined, needed: false, reasonFa: fa.planner.upgradeNotNeeded(fmt(stats.memoryPct), fmt(stats.cpuPct)) };
  }
  const what = [memHigh && fa.planner.memoryWord, cpuHigh && fa.planner.cpuWord].filter(Boolean).join(fa.planner.and);
  const next = (await catalog.list()).find(
    (p) =>
      p.available &&
      p.kind === 'app' &&
      p.priceMonthlyToman > current.priceMonthlyToman &&
      (!memHigh || p.ramMb > current.ramMb) &&
      (!cpuHigh || p.cpu > current.cpu),
  );
  if (!next) return { current, next: undefined, needed: true, reasonFa: fa.planner.upgradeAtTop(what) };
  return { current, next, needed: true, reasonFa: fa.planner.upgradeTo(next.id, what) };
}
