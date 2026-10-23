import { z } from 'zod';
import { preApprovedApprover } from '../deploy/redeploy.js';
import { waitAppGone } from '../liara/index.js';
import { backupDownloadLink, createBackup, createDisk, resizeDisk } from '../ops/backups.js';
import type { OpsContext } from '../ops/context.js';
import { deleteApp } from '../ops/delete.js';
import { setEnv, unsetEnv } from '../ops/env.js';
import { rollbackApp } from '../ops/releases.js';
import { setDefaultSubdomain, setFixedIp, setReadOnly, setZeroDowntime } from '../ops/settings.js';
import type { GuardResult } from '../safety/approval.js';
import { Risk } from '../safety/risk.js';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';
import { defineTool, type ToolContext, type ToolDefinition } from './types.js';

/**
 * Management tools over the gated ops functions (T6.x), so the CLI (T9.2), the agent and MCP (T9.8)
 * all go through the registry. `buildPlan` is a dry run of the ops function (its own plan, no side
 * effects, no audit); the handler runs it again with that one action pre-approved, so the registry's
 * gate is the single approval (and the MCP two-step works unchanged).
 */

type OpResult<R> = GuardResult<R> | { status: 'no-change'; messageFa: string };

const denyAll = { request: async () => 'denied' as const };

function innerCtx(ctx: ToolContext, extra: Partial<OpsContext>): OpsContext {
  // the outer gate audits; the inner call must not ask, audit or consume the MCP token again
  const { audit: _a, confirmToken: _t, ...rest } = ctx;
  return { ...rest, ...extra } as OpsContext;
}

function opTool<I extends { app?: string }, R>(def: {
  name: string;
  descriptionFa: string;
  descriptionEn: string;
  inputSchema: z.ZodType<I>;
  risk: Risk;
  run: (a: I, ctx: ToolContext, ops: OpsContext) => Promise<OpResult<R>>;
}): ToolDefinition<I, R | { status: 'no-change'; messageFa: string }> {
  return defineTool({
    name: def.name,
    descriptionFa: def.descriptionFa,
    descriptionEn: def.descriptionEn,
    inputSchema: def.inputSchema,
    risk: def.risk,
    buildPlan: async (a, ctx) => {
      const r = await def.run(a, ctx, innerCtx(ctx, { approver: denyAll, dryRun: true }));
      if (r.status === 'no-change') throw new ValidationError(`${def.name}: nothing to change`, { messageFa: r.messageFa });
      if (r.status !== 'dry-run') throw new Error(`${def.name}: dry run returned ${r.status}`);
      return r.plan;
    },
    handler: async (a, ctx) => {
      const r = await def.run(a, ctx, innerCtx(ctx, { approver: preApprovedApprover(ctx.approver, def.name, a.app as string), dryRun: false }));
      if (r.status === 'no-change') return r;
      if (r.status !== 'executed') throw new Error(`${def.name}: ${r.status}`);
      return r.result;
    },
  });
}

const app = z.string().min(1).describe('Liara app name');
const reason = z.string().optional().describe('Why (shown on the approval card)');
const m = fa.manageTools;
const reasonOpt = (r: string | undefined) => (r ? { reasonFa: r } : {});

export function manageTools(opts: { wait?: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } } = {}): ToolDefinition[] {
  const tools = [
    opTool({
      name: 'rollback_app',
      descriptionFa: m.rollback,
      descriptionEn: 'Roll an app back to its last healthy deployment (or `targetId` from list_deployments) (R2).',
      inputSchema: z.object({ app, targetId: z.string().optional(), reason }),
      risk: Risk.R2,
      run: (a, ctx, ops) => rollbackApp({ ledger: ctx.liara.ledger, deploy: ctx.liara.deploy }, a.app, ops, { ...(a.targetId ? { targetId: a.targetId } : {}), ...reasonOpt(a.reason) }),
    }),
    opTool({
      name: 'set_env',
      descriptionFa: m.setEnv,
      descriptionEn: 'Add or change environment variables of an app (R1; R2 for secret-looking names). Values are never echoed back.',
      inputSchema: z.object({ app, vars: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => setEnv(ctx.liara.env, a.app, a.vars, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'unset_env',
      descriptionFa: m.unsetEnv,
      descriptionEn: 'Remove environment variables of an app (R2).',
      inputSchema: z.object({ app, keys: z.array(z.string().min(1)).min(1), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => unsetEnv(ctx.liara.env, a.app, a.keys, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'set_zero_downtime',
      descriptionFa: m.setting('zero-downtime'),
      descriptionEn: 'Turn zero-downtime deployment on/off for an app (R1).',
      inputSchema: z.object({ app, on: z.boolean(), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => setZeroDowntime(ctx.liara.settings, a.app, a.on, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'set_default_subdomain',
      descriptionFa: m.setting('subdomain'),
      descriptionEn: 'Turn the default <app>.liara.run subdomain on/off (R1; R2 when it is the only address).',
      inputSchema: z.object({ app, on: z.boolean(), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => setDefaultSubdomain(ctx.liara.settings, ctx.liara.domains, a.app, a.on, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'set_fixed_ip',
      descriptionFa: m.setting('fixed-ip'),
      descriptionEn: 'Turn the fixed outbound IP on/off for an app (R2, costs money).',
      inputSchema: z.object({ app, on: z.boolean(), reason }),
      risk: Risk.R2,
      run: (a, ctx, ops) => setFixedIp(ctx.liara.settings, a.app, a.on, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'set_read_only',
      descriptionFa: m.setting('read-only'),
      descriptionEn: 'Turn the read-only filesystem on/off for an app (R1; R2 when the app writes to disk).',
      inputSchema: z.object({ app, on: z.boolean(), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => setReadOnly(ctx.liara.settings, a.app, a.on, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'create_disk',
      descriptionFa: m.createDisk,
      descriptionEn: 'Create a disk for an app (R2, costs money).',
      inputSchema: z.object({ app, name: z.string().min(1), sizeGb: z.number().int().positive(), reason }),
      risk: Risk.R2,
      run: (a, ctx, ops) => createDisk(ctx.liara.disks, a.app, { name: a.name, sizeGb: a.sizeGb }, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'resize_disk',
      descriptionFa: m.resizeDisk,
      descriptionEn: 'Resize a disk of an app (R2).',
      inputSchema: z.object({ app, disk: z.string().min(1), sizeGb: z.number().int().positive(), reason }),
      risk: Risk.R2,
      run: (a, ctx, ops) => resizeDisk(ctx.liara.disks, a.app, a.disk, a.sizeGb, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'create_backup',
      descriptionFa: m.createBackup,
      descriptionEn: 'Take a backup of an app disk (R1).',
      inputSchema: z.object({ app, disk: z.string().min(1), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => createBackup(ctx.liara.disks, a.app, a.disk, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'backup_download_link',
      descriptionFa: m.backupLink,
      descriptionEn: 'Get a temporary download link for a disk backup (R1; the link is a secret and is not shown to the LLM).',
      inputSchema: z.object({ app, disk: z.string().min(1), backup: z.string().min(1), reason }),
      risk: Risk.R1,
      run: (a, ctx, ops) => backupDownloadLink(ctx.liara.disks, a.app, a.disk, a.backup, ops, reasonOpt(a.reason)),
    }),
    opTool({
      name: 'delete_app',
      descriptionFa: m.deleteApp,
      descriptionEn: 'Delete an app with its disks and domains (R3: the user must type the app name).',
      inputSchema: z.object({ app, reason }),
      risk: Risk.R3,
      run: (a, ctx, ops) =>
        deleteApp(
          { apps: { deleteApp: (n) => ctx.liara.apps.deleteApp(n), waitGone: (n) => waitAppGone(ctx.liara.apps, n, opts.wait ?? {}) }, disks: ctx.liara.disks, domains: ctx.liara.domains },
          a.app,
          ops,
          reasonOpt(a.reason),
        ),
    }),
  ];
  return tools as ToolDefinition[];
}
