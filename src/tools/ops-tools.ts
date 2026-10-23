import { z } from 'zod';
import { getAppOverview, type OverviewDeps } from '../ops/service.js';
import { Risk } from '../safety/risk.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolDefinition } from './types.js';

/** Service tools (T6.1+). `app_overview` is read-only (R0). */

export type OpsToolsOptions = Omit<OverviewDeps, 'liara'>;

export function opsTools(opts: OpsToolsOptions = {}): ToolDefinition[] {
  const tools = [
    defineTool({
      name: 'app_overview',
      descriptionFa: fa.overview.toolDescription,
      descriptionEn:
        'One-call overview of an app: status/scale, plan, last deploy, env count, domains+SSL, disks, resource usage, recent events and an HTTP probe. Failed sources are listed in `failed`.',
      inputSchema: z.object({ app: z.string().min(1).describe('Liara app name') }),
      risk: Risk.R0,
      handler: async (a, ctx) => getAppOverview(a.app, { ...opts, liara: ctx.liara }),
    }),
  ];
  return tools as ToolDefinition[];
}
