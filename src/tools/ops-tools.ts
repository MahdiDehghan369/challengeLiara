import { z } from 'zod';
import { execPower, execResize, getAppOverview, planPower, planResize, prepareResize, type OverviewDeps, type PowerAction, type PowerExecOptions, type PowerOptions } from '../ops/service.js';
import { PlanCatalog } from '../planner/plans.js';
import { Risk } from '../safety/risk.js';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolDefinition } from './types.js';

/**
 * Service tools (T6.1, T6.2). `app_overview` is R0. Power tools reuse the ops plan builder as
 * `buildPlan` and the raw executor as handler, so the registry's gate is the only approval.
 */

export type OpsToolsOptions = Omit<OverviewDeps, 'liara'> & {
  power?: Pick<PowerOptions, 'downtimeSec' | 'zeroDowntime'> &
    Pick<PowerExecOptions, 'wait' | 'now'> & {
      /** Readiness check after restart/start, per app (e.g. a probe of its URL). */
      probeFor?: (app: string) => () => Promise<boolean>;
    };
};

const App = z.object({ app: z.string().min(1).describe('Liara app name'), reason: z.string().optional().describe('Why (shown on the approval card)') });

export function opsTools(opts: OpsToolsOptions = {}): ToolDefinition[] {
  const { power, ...overview } = opts;
  const powerTool = (action: PowerAction, name: string, descriptionFa: string, descriptionEn: string, risk: Risk) =>
    defineTool({
      name,
      descriptionFa,
      descriptionEn,
      inputSchema: App,
      risk,
      buildPlan: async (a, ctx) =>
        planPower(action, a.app, ctx, {
          ...(a.reason ? { reasonFa: a.reason } : {}),
          ...(power?.downtimeSec !== undefined ? { downtimeSec: power.downtimeSec } : {}),
          ...(power?.zeroDowntime !== undefined ? { zeroDowntime: power.zeroDowntime } : {}),
        }),
      handler: async (a, ctx) =>
        execPower(ctx.liara.apps, action, a.app, {
          ...(power?.wait ? { wait: power.wait } : {}),
          ...(power?.now ? { now: power.now } : {}),
          ...(power?.probeFor && action !== 'stop' ? { probe: power.probeFor(a.app) } : {}),
        }),
    });
  const tools = [
    defineTool({
      name: 'app_overview',
      descriptionFa: fa.overview.toolDescription,
      descriptionEn:
        'One-call overview of an app: status/scale, plan, last deploy, env count, domains+SSL, disks, resource usage, recent events and an HTTP probe. Failed sources are listed in `failed`.',
      inputSchema: z.object({ app: z.string().min(1).describe('Liara app name') }),
      risk: Risk.R0,
      handler: async (a, ctx) => getAppOverview(a.app, { ...overview, liara: ctx.liara }),
    }),
    powerTool('restart', 'restart_app', fa.power.restartTool, 'Restart an app and confirm it is running again (R1).', Risk.R1),
    powerTool('start', 'start_app', fa.power.startTool, 'Start a stopped app (scale=1) and confirm it is running (R1).', Risk.R1),
    powerTool('stop', 'stop_app', fa.power.stopTool, 'Stop an app (scale=0) and confirm it stopped (R2; R3 for production/protected apps).', Risk.R2),
    defineTool({
      name: 'resize_app',
      descriptionFa: fa.resize.toolDescription,
      descriptionEn: 'Change the plan of an app (R2). Checks the balance first; the card shows current → new plan and the monthly cost difference.',
      inputSchema: z.object({
        app: z.string().min(1),
        planID: z.string().min(1).describe('Target plan id from list_plans'),
        reason: z.string().optional().describe('Why, e.g. "RAM reached 95% in the last 24h"'),
      }),
      risk: Risk.R2,
      buildPlan: async (a, ctx) => {
        const catalog = overview.catalog ?? new PlanCatalog(ctx.liara.cli);
        const prep = await prepareResize({ apps: ctx.liara.apps, billing: ctx.liara.billing, catalog }, a.app, a.planID);
        if (prep.status === 'no-change') throw new ValidationError('same plan', { messageFa: prep.messageFa });
        return planResize(a.app, prep.from, prep.to, ctx, a.reason ? { reasonFa: a.reason } : {});
      },
      handler: async (a, ctx) => execResize(ctx.liara.apps, a.app, a.planID, power?.wait ? { wait: power.wait } : {}),
    }),
  ];
  return tools as ToolDefinition[];
}
