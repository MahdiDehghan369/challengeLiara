import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createLiaraClient } from '../../../src/liara/index.js';
import { McpApprover, ScriptedApprover, YesApprover, type GuardAuditRecord } from '../../../src/safety/approval.js';
import { parsePolicy } from '../../../src/safety/policy.js';
import { Risk } from '../../../src/safety/risk.js';
import { BudgetExceededError } from '../../../src/shared/errors.js';
import { Secret } from '../../../src/shared/secret.js';
import { defineTool, forLlm, ToolRegistry, type ToolContext, type ToolUiEvent } from '../../../src/tools/index.js';

const liara = createLiaraClient({ liara: { token: undefined, teamId: undefined, mode: 'mock' }, dataDir: '.siavash-test' });

const calls: string[] = [];
const readTool = defineTool({
  name: 'list_things',
  descriptionFa: 'فهرست',
  descriptionEn: 'List things for an app',
  inputSchema: z.object({ app: z.string().min(1), limit: z.number().int().positive().max(50).default(10) }),
  risk: Risk.R0,
  handler: async (a) => {
    calls.push(`list:${a.app}:${a.limit}`);
    return { items: Array.from({ length: a.limit }, (_, i) => `item-${i}`), token: new Secret('tok-should-not-leak'), dsn: 'postgres://u:hunter2pw@h/db' };
  },
});

const resizeTool = defineTool({
  name: 'resize_thing',
  descriptionFa: 'تغییر اندازه',
  descriptionEn: 'Resize an app (costs money)',
  inputSchema: z.object({ app: z.string(), planID: z.enum(['small', 'medium', 'large']) }),
  risk: Risk.R2,
  buildPlan: async (a) => ({
    id: 'p1',
    toolName: 'resize_thing',
    titleFa: `تغییر پلن ${a.app}`,
    reasonFa: 'کمبود حافظه',
    target: { app: a.app },
    risk: Risk.R2,
    costToman: { monthly: a.planID === 'large' ? 9_000_000 : 800_000 },
    impactFa: 'ری‌استارت',
    rollbackFa: 'پلن قبلی',
    command: `POST /v1/projects/${a.app}/resize {planID: ${a.planID}}`,
    params: { app: a.app, planID: a.planID },
  }),
  handler: async (a) => {
    calls.push(`resize:${a.app}:${a.planID}`);
    return { accepted: true };
  },
});

function setup(approver: ToolContext['approver'], extra: Partial<ToolContext> = {}) {
  calls.length = 0;
  const audit: GuardAuditRecord[] = [];
  const events: ToolUiEvent[] = [];
  const reg = new ToolRegistry().register(readTool).register(resizeTool);
  const ctx: ToolContext = { liara, approver, audit: { record: (r) => audit.push(r) }, ui: { emit: (e) => events.push(e) }, ...extra };
  return { reg, ctx, audit, events };
}

describe('ToolRegistry', () => {
  it('lists tools and exports JSON-Schema tool definitions (OpenAI + MCP)', () => {
    const { reg } = setup(new ScriptedApprover([]));
    expect(reg.list().map((t) => t.name)).toEqual(['list_things', 'resize_thing']);
    const [t] = reg.toOpenAiTools();
    expect(t).toMatchObject({ name: 'list_things', description: 'List things for an app', parameters: { type: 'object', required: ['app'] } });
    expect(reg.toMcpTools()[1]?.inputSchema).toMatchObject({ properties: { planID: { enum: ['small', 'medium', 'large'] } } });
    expect(() => new ToolRegistry().register(readTool).register(readTool)).toThrow(/duplicate/);
  });

  it('R0: runs without asking, audited, output redacted (Secrets, passwords) for the LLM', async () => {
    const approver = new ScriptedApprover([]);
    const { reg, ctx, audit, events } = setup(approver);
    const r = await reg.invoke('list_things', { app: 'shop', limit: 2 }, ctx);
    expect(r.ok && r.status).toBe('executed');
    expect(approver.seen).toHaveLength(0);
    expect(audit[0]).toMatchObject({ decision: 'auto-r0', result: 'ok' });
    expect(r.forLlm).toContain('item-1');
    expect(r.forLlm).not.toContain('tok-should-not-leak');
    expect(r.forLlm).not.toContain('hunter2pw');
    expect(events.map((e) => e.type)).toEqual(['tool_start', 'tool_end']);
  });

  it('invalid input → readable error for the LLM, not an exception; handler not called', async () => {
    const { reg, ctx } = setup(new ScriptedApprover([]));
    const r = await reg.invoke('list_things', { app: '', limit: 999 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_INPUT');
    expect(r.forLlm).toContain('app');
    expect(r.forLlm).toContain('limit');
    expect(r.error.messageFa).toContain('list_things');
    expect(calls).toEqual([]);
  });

  it('unknown tool → error listing available tools', async () => {
    const { reg, ctx } = setup(new ScriptedApprover([]));
    const r = await reg.invoke('rm_rf', {}, ctx);
    expect(r).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(r.forLlm).toContain('list_things');
  });

  it('R2: goes through the approver; approved → runs; denied → {ok:false}, not run', async () => {
    const ok = setup(new ScriptedApprover(['approved']));
    expect((await ok.reg.invoke('resize_thing', { app: 'shop', planID: 'medium' }, ok.ctx)).ok).toBe(true);
    expect(calls).toEqual(['resize:shop:medium']);

    const denied = setup(new ScriptedApprover(['denied']));
    const r = await denied.reg.invoke('resize_thing', { app: 'shop', planID: 'medium' }, denied.ctx);
    expect(r).toMatchObject({ ok: false, error: { code: 'APPROVAL_DENIED' } });
    expect(calls).toEqual([]);
  });

  it('--yes cannot approve R2 through the registry', async () => {
    const { reg, ctx } = setup(new YesApprover());
    expect((await reg.invoke('resize_thing', { app: 'shop', planID: 'small' }, ctx)).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it('edited params are validated again; invalid edit never runs', async () => {
    const good = setup(new ScriptedApprover([{ edited: { app: 'shop', planID: 'small' } }]));
    await good.reg.invoke('resize_thing', { app: 'shop', planID: 'medium' }, good.ctx);
    expect(calls).toEqual(['resize:shop:small']);

    const bad = setup(new ScriptedApprover([{ edited: { app: 'shop', planID: 'gigantic' } }]));
    const r = await bad.reg.invoke('resize_thing', { app: 'shop', planID: 'medium' }, bad.ctx);
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(calls).toEqual([]);
  });

  it('policy cost cap and dry-run are honoured', async () => {
    const capped = setup(new ScriptedApprover(['approved']), { policy: parsePolicy({ maxMonthlyCostToman: 1_000_000 }) });
    expect(await capped.reg.invoke('resize_thing', { app: 'shop', planID: 'large' }, capped.ctx)).toMatchObject({ ok: false, error: { code: 'APPROVAL_DENIED' } });

    const dry = setup(new ScriptedApprover([]), { dryRun: true });
    const r = await dry.reg.invoke('resize_thing', { app: 'shop', planID: 'large' }, dry.ctx);
    expect(r.ok && r.status).toBe('dry-run');
    expect(calls).toEqual([]);
  });

  it('MCP two-step: pending with a token, then executes with it', async () => {
    const mcp = new McpApprover();
    const { reg, ctx } = setup(mcp);
    const first = await reg.invoke('resize_thing', { app: 'shop', planID: 'small' }, ctx);
    expect(first.ok && first.status).toBe('pending');
    const token = first.ok ? first.confirmToken : undefined;
    expect(calls).toEqual([]);
    const second = await reg.invoke('resize_thing', { app: 'shop', planID: 'small' }, { ...ctx, ...(token ? { confirmToken: token } : {}) });
    expect(second.ok && second.status).toBe('executed');
    expect(calls).toEqual(['resize:shop:small']);
  });

  it('handler errors become {ok:false}; budget errors propagate', async () => {
    const reg = new ToolRegistry()
      .register(defineTool({ name: 'boom', descriptionFa: 'x', descriptionEn: 'x', inputSchema: z.object({}), risk: Risk.R0, handler: async () => { throw new Error('kaput postgres://u:pw12345@h/db'); } }))
      .register(defineTool({ name: 'spend', descriptionFa: 'x', descriptionEn: 'x', inputSchema: z.object({}), risk: Risk.R0, handler: async () => { throw new BudgetExceededError('stop'); } }));
    const ctx: ToolContext = { liara, approver: new ScriptedApprover([]) };
    const r = await reg.invoke('boom', {}, ctx);
    expect(r).toMatchObject({ ok: false, error: { code: 'TOOL_ERROR' } });
    expect(r.forLlm).not.toContain('pw12345');
    await expect(reg.invoke('spend', {}, ctx)).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('forLlm caps output at 4000 chars', () => {
    const out = forLlm({ big: 'x'.repeat(10_000) });
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out).toContain('truncated');
  });
});
