import type { LiaraClient, WaitOptions } from '../liara/index.js';
import { createDisk } from '../ops/backups.js';
import type { OpsContext } from '../ops/context.js';
import { setEnv } from '../ops/env.js';
import { rollbackApp } from '../ops/releases.js';
import { powerApp, resizeApp } from '../ops/service.js';
import { setReadOnly } from '../ops/settings.js';
import type { PlanCatalog } from '../planner/plans.js';
import { isSecretEnvName } from '../safety/risk.js';
import { Secret } from '../shared/secret.js';
import { CANCELLED, type Prompter } from '../ui/cli/approver.js';
import { fa } from '../ui/cli/i18n/fa.js';
import type { Hypothesis } from './rca.js';
import { manualSteps, type RemediationOption } from './remediate.js';

/**
 * Executes one remediation option (T8.12) through the existing gated ops — never around the Safety Gate.
 * Code fixes go through a `CodeFixRouter` (T8.15 adds self / handoff / report; default is self = T8.9).
 */

export interface CodeFixRequest {
  app: string;
  hypothesis: Hypothesis;
  /** Error text with stack (from the evidence), redacted downstream. */
  error: string;
  incidentId: string;
}

export interface CodeFixRouter {
  fix(req: CodeFixRequest): Promise<{ status: string; messageFa?: string }>;
}

export interface ExecuteDeps {
  liara: Pick<LiaraClient, 'apps' | 'env' | 'billing' | 'ledger' | 'deploy' | 'settings' | 'disks'>;
  ui: Prompter;
  ops: OpsContext;
  catalog?: PlanCatalog;
  codeFix?: CodeFixRouter;
  wait?: Pick<WaitOptions<unknown>, 'timeoutMs' | 'intervalMs' | 'sleep'>;
}

export type ExecuteStatus = 'executed' | 'manual' | 'skipped' | 'failed';

export interface ExecuteResult {
  status: ExecuteStatus;
  messageFa?: string;
  manualStepsFa?: string[];
}

function manual(option: RemediationOption, hypothesis: Hypothesis, ui: Prompter, noteFa?: string): ExecuteResult {
  const steps = option.manualStepsFa ?? manualSteps(hypothesis, option);
  ui.note([...(noteFa ? [noteFa] : []), ...steps].join('\n'), fa.doctor.manualTitle);
  return { status: 'manual', manualStepsFa: steps, ...(noteFa ? { messageFa: noteFa } : {}) };
}

export async function executeRemediation(
  option: RemediationOption,
  hypothesis: Hypothesis,
  deps: ExecuteDeps,
  ctx: { app: string; error: string; incidentId: string },
): Promise<ExecuteResult> {
  const { liara, ops, ui } = deps;
  const app = ctx.app;
  const status = (r: { status: string }): ExecuteResult => (r.status === 'executed' || r.status === 'no-change' ? { status: 'executed' } : { status: 'failed' });
  switch (option.tool) {
    case 'set_env': {
      let name = typeof option.args.name === 'string' ? option.args.name : undefined;
      if (!name) {
        // the logs did not name the variable: ask instead of guessing
        const typed = await ui.text(fa.doctor.askEnvName, { validate: (v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.trim()) ? undefined : fa.doctor.badEnvName) });
        if (typed === CANCELLED || !typed.trim()) return manual(option, hypothesis, ui);
        name = typed.trim();
      }
      const secret = isSecretEnvName(name);
      const raw = secret && ui.password ? await ui.password(fa.doctor.askEnvSecret(name)) : secret ? CANCELLED : await ui.text(fa.doctor.askEnvValue(name));
      if (raw === CANCELLED || !raw.trim()) return { status: 'skipped', messageFa: fa.doctor.noValue(name) };
      return status(await setEnv(liara.env, app, { [name]: secret ? new Secret(raw.trim()) : raw.trim() }, ops, { reasonFa: hypothesis.titleFa }));
    }
    case 'resize_app': {
      if (!deps.catalog || typeof option.args.planID !== 'string') return manual(option, hypothesis, ui);
      return status(await resizeApp({ apps: liara.apps, billing: liara.billing, catalog: deps.catalog }, app, option.args.planID, ops, { reasonFa: hypothesis.titleFa, ...(deps.wait ? { wait: deps.wait } : {}) }));
    }
    case 'restart_app':
      return status(await powerApp(liara.apps, 'restart', app, ops, { reasonFa: hypothesis.titleFa, ...(deps.wait ? { wait: deps.wait } : {}) }));
    case 'rollback_app':
      return status(await rollbackApp({ ledger: liara.ledger, deploy: liara.deploy }, app, ops, { reasonFa: hypothesis.titleFa }));
    case 'set_read_only':
      return status(await setReadOnly(liara.settings, app, Boolean(option.args.on), ops, { reasonFa: hypothesis.titleFa }));
    case 'create_disk':
      return status(await createDisk(liara.disks, app, { name: 'data', sizeGb: 1 }, ops, { reasonFa: hypothesis.titleFa }));
    case 'code_patch': {
      if (!deps.codeFix) return manual(option, hypothesis, ui, fa.doctor.noCodeFix);
      const r = await deps.codeFix.fix({ app, hypothesis, error: ctx.error, incidentId: ctx.incidentId });
      if (['deployed', 'applied'].includes(r.status)) return { status: 'executed' };
      // handed off to the user's agent / report only: the incident stays open (waiting-fix), not failed
      if (['waiting-fix', 'reported', 'gave-up'].includes(r.status)) return { status: 'manual', ...(r.messageFa ? { messageFa: r.messageFa } : {}) };
      if (r.status === 'skipped') return { status: 'skipped' };
      return { status: 'failed', ...(r.messageFa ? { messageFa: r.messageFa } : {}) };
    }
    case 'manual':
      return manual(option, hypothesis, ui);
    default:
      // redeploy_app / run_migration need more context than the doctor has here
      return manual(option, hypothesis, ui, fa.doctor.notSupported);
  }
}
