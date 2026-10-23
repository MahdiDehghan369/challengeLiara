import type { LiaraClient } from '../../liara/index.js';
import { guardOptions, newPlanId, type OpsContext } from '../../ops/context.js';
import { estimateCost, requiredBalance, type CostEstimate } from '../../planner/cost.js';
import type { PlanCatalog } from '../../planner/plans.js';
import { recommendPlans, type PlanOption, type Tier } from '../../planner/recommend.js';
import { guard, planHash } from '../../safety/approval.js';
import type { Policy } from '../../safety/policy.js';
import { Risk, type ActionPlan } from '../../safety/risk.js';
import { ApprovalDeniedError } from '../../shared/errors.js';
import { CANCELLED, type Prompter } from '../../ui/cli/approver.js';
import { toman } from '../../ui/cli/format.js';
import { fa } from '../../ui/cli/i18n/fa.js';
import type { StepOutcome, Step } from '../pipeline-engine.js';
import type { AnalyzeState } from './analyze.js';

/**
 * Plan & Billing (T5.4): choose one of the three plan options, check the balance (top-up only via the
 * console: wait as a human step, polling every 15 s), then one R2 approval card for the whole deploy
 * plan through the Safety Gate. Nothing is created here; T5.5 provisions only after `deployApproval`.
 */

export { BALANCE_FACTOR, requiredBalance } from '../../planner/cost.js';
export const TOP_UP_POLL_MS = 15_000;

export interface PlanBillingState extends AnalyzeState {
  planChoice?: { tier: Tier; planId: string; monthlyToman: number; ramMb: number; cpu: number };
  cost?: CostEstimate;
  balanceToman?: number;
  /** Set only after the R2 approval; T5.5 refuses to provision without it. */
  deployApproval?: { planHash: string; approvedAt: string };
}

export interface PlanBillingDeps {
  liara: Pick<LiaraClient, 'billing'>;
  catalog: PlanCatalog;
  ui: Prompter;
  ops: OpsContext;
  policy?: Policy;
  yes?: boolean;
  pollMs?: number;
  /** `--yes`: how long to poll for a top-up before pausing the pipeline (default 10 min). */
  maxWaitMs?: number;
  /** Polls after "I topped up" before asking again (default 4, i.e. one minute). */
  pollsAfterTopUp?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function optionLabel(o: PlanOption): string {
  return fa.planBilling.option(fa.planBilling.tier[o.tier] ?? o.tier, o.plan.id, o.plan.ramMb, o.plan.cpu, toman(o.monthlyToman));
}

export function buildDeployPlan(state: PlanBillingState): ActionPlan {
  const pb = fa.planBilling;
  const report = state.report;
  const choice = state.planChoice!;
  const cost = state.cost!;
  const app = state.appName!;
  const dbs = report?.deps.databases.map((d) => d.type) ?? [];
  const diskFolders = report?.deps.disk.needed ? report.deps.disk.folders : [];
  const impact = [
    pb.impactApp(choice.planId, toman(choice.monthlyToman)),
    ...dbs.map((t) => pb.impactDb(t)),
    ...(diskFolders.length > 0 ? [pb.impactDisk(diskFolders.join(', '))] : []),
    pb.impactTotal(toman(cost.totalMonthlyToman), cost.complete),
  ];
  const platform = report?.platform.liaraPlatformId ?? report?.platform.platform ?? 'unknown';
  return {
    id: newPlanId('deploy-plan'),
    toolName: 'approve_deploy_plan',
    titleFa: pb.approveTitle(app),
    reasonFa: pb.approveReason,
    target: { app },
    risk: Risk.R2,
    costToman: { monthly: cost.totalMonthlyToman },
    impactFa: impact.join('\n'),
    rollbackFa: pb.rollback,
    command: [
      `POST /v1/projects {name: ${app}, planID: ${choice.planId}, platform: ${platform}}`,
      ...dbs.map((t) => `liara db create -t ${t}`),
      ...(diskFolders.length > 0 ? [`POST /v1/projects/${app}/disks`] : []),
      `liara deploy --app ${app}`,
    ].join('\n'),
    params: { app, planId: choice.planId, platform, databases: dbs, diskFolders, monthlyToman: cost.totalMonthlyToman },
  };
}

export function planBillingStep<S extends PlanBillingState>(deps: PlanBillingDeps): Step<S> {
  const pb = fa.planBilling;
  const sleep = deps.sleep ?? defaultSleep;
  const pollMs = deps.pollMs ?? TOP_UP_POLL_MS;

  /** Polls up to `polls` times; returns the last balance and whether it is enough. */
  const poll = async (need: number, polls: number, signal?: AbortSignal) => {
    let balance = (await deps.liara.billing.getBilling()).balanceToman;
    for (let i = 0; i < polls && balance < need && !signal?.aborted; i++) {
      await sleep(pollMs);
      balance = (await deps.liara.billing.getBilling()).balanceToman;
    }
    return { balance, enough: balance >= need };
  };

  return {
    id: 'plan-billing',
    titleFa: pb.title,
    onFail: 'abort',
    skipIf: (ctx) => ctx.state.redeploy === true,
    run: async (ctx): Promise<StepOutcome> => {
      const { ui } = deps;
      const s = ctx.state;
      const report = s.report;
      if (!report || !s.appName) throw new Error('plan-billing needs the analyze step first');

      // 1) plan choice (kept across a resume after a top-up pause)
      if (!s.planChoice) {
        const rec = await recommendPlans(deps.catalog, {
          platform: report.platform.platform,
          sizeMb: report.size.mb,
          ...(s.goal ? { goal: s.goal } : {}),
        });
        let tier: Tier = 'recommended';
        if (!deps.yes) {
          const picked = await ui.select<Tier>(
            pb.chooseQuestion,
            // recommended first: it is the default
            [...rec.options].sort((a, b) => Number(b.tier === 'recommended') - Number(a.tier === 'recommended')).map((o) => ({ value: o.tier, label: optionLabel(o) })),
          );
          if (picked === CANCELLED) throw new ApprovalDeniedError('cancelled by user', { messageFa: fa.analyzeStep.cancelled });
          tier = picked;
        }
        const o = rec.options.find((x) => x.tier === tier)!;
        s.planChoice = { tier, planId: o.plan.id, monthlyToman: o.monthlyToman, ramMb: o.plan.ramMb, cpu: o.plan.cpu };
      }

      // 2) cost
      const db = report.deps.databases[0];
      s.cost = await estimateCost(deps.catalog, {
        appPlanId: s.planChoice.planId,
        ...(db ? { db: { planId: db.type } } : {}),
        // TODO(OQ-29): disk size/price unknown; 1 GB is shown as a placeholder size only.
        ...(report.deps.disk.needed ? { diskGb: 1 } : {}),
      });

      // 3) balance (top-up is human-only)
      const billing = await deps.liara.billing.getBilling();
      const need = requiredBalance(s.cost.totalMonthlyToman, billing.minCreditThreshold ?? 0);
      s.balanceToman = billing.balanceToman;
      if (billing.balanceToman < need) {
        ctx.setStatus('waiting-human', pb.lowBalance(toman(billing.balanceToman), toman(need)));
        ui.note(pb.lowBalance(toman(billing.balanceToman), toman(need)), pb.lowBalanceTitle);
        let enough = false;
        if (deps.yes) {
          const polls = Math.ceil((deps.maxWaitMs ?? 10 * 60_000) / pollMs);
          const r = await poll(need, polls, ctx.signal);
          s.balanceToman = r.balance;
          enough = r.enough;
        } else {
          for (;;) {
            const choice = await ui.select(pb.topUpQuestion, [
              { value: 'charged', label: pb.toppedUp },
              { value: 'cancel', label: pb.cancelTopUp },
            ]);
            if (choice !== 'charged') break;
            const r = await poll(need, deps.pollsAfterTopUp ?? 4, ctx.signal);
            s.balanceToman = r.balance;
            if (r.enough) {
              enough = true;
              break;
            }
            ui.note(pb.stillLow(toman(r.balance)), pb.lowBalanceTitle);
          }
        }
        if (!enough) return { status: 'waiting-human', messageFa: pb.waitingTopUp(toman(need)) };
        ctx.setStatus('running', pb.balanceOk(toman(s.balanceToman)));
      }

      // 4) one R2 approval for the whole plan (nothing is created here)
      const plan = buildDeployPlan(s);
      ctx.setStatus('waiting-approval');
      const res = await guard(
        plan,
        deps.ops.approver,
        async () => {
          s.deployApproval = { planHash: planHash(plan), approvedAt: (deps.now ?? (() => new Date()))().toISOString() };
          return true;
        },
        { ...guardOptions(deps.ops), ...(deps.policy ? { policy: deps.policy } : {}) },
      );
      if (res.status !== 'executed') throw new Error(`deploy plan not approved (${res.status})`);
      ctx.setStatus('running');
      return undefined;
    },
  };
}
