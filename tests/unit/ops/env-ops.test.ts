import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EnvApi, type EnvCli } from '../../../src/liara/env.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { listEnvMasked, planSetEnv, setEnv, unsetEnv } from '../../../src/ops/env.js';
import { ScriptedApprover, type ApprovalDecision } from '../../../src/safety/approval.js';
import { AuditLog } from '../../../src/safety/audit.js';
import { Risk } from '../../../src/safety/risk.js';
import { ApprovalDeniedError } from '../../../src/shared/errors.js';
import { Secret } from '../../../src/shared/secret.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Fake Liara whose update-envs REPLACES the whole set (worst case). */
function setup(initial: Record<string, string>) {
  let state = { ...initial };
  let posts = 0;
  server.use(
    http.post(`${BASE}/v1/projects/update-envs`, async ({ request }) => {
      posts++;
      const body = (await request.json()) as { variables: Array<{ key: string; value: string }> };
      state = Object.fromEntries(body.variables.map((v) => [v.key, v.value]));
      return HttpResponse.json({ message: 'ok' });
    }),
  );
  const cli: EnvCli = {
    envList: async () => Object.entries(state).map(([key, v]) => ({ key, value: new Secret(v) })),
    envUnset: async (_a, keys) => {
      for (const k of keys) delete state[k];
    },
  };
  const env = new EnvApi(new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} }), cli);
  const dir = mkdtempSync(join(tmpdir(), 'siavash-ops-env-'));
  const audit = new AuditLog(dir);
  const ctx = (decisions: ApprovalDecision[]) => {
    const approver = new ScriptedApprover(decisions);
    return { ctx: { approver, audit, sessionId: 's' }, approver };
  };
  return { env, audit, ctx, state: () => state, posts: () => posts };
}

describe('ops/env', () => {
  it('list_env masks values (secret names fully)', async () => {
    const s = setup({ DATABASE_URL: 'postgres://u:p@h/db', APP_NAME: 'shop-frontend' });
    const list = await listEnvMasked(s.env, 'shop');
    expect(list).toEqual([
      { key: 'DATABASE_URL', masked: '••••••', isSecret: true },
      { key: 'APP_NAME', masked: 'shop••••(13)', isSecret: false },
    ]);
  });

  it('set_env: several vars in ONE approval, no previous env lost, secret name → R2', async () => {
    const s = setup({ A: '1', KEEP: 'k' });
    const { ctx, approver } = s.ctx(['approved']);
    const r = await setEnv(s.env, 'shop', { A: '2', NEW: 'n', API_KEY: new Secret('sk-xyz-123456') }, ctx);
    expect(r.status).toBe('executed');
    expect(approver.seen).toHaveLength(1);
    expect(approver.seen[0]?.risk).toBe(Risk.R2);
    expect(approver.seen[0]?.impactFa).toContain('API_KEY');
    expect(s.state()).toEqual({ A: '2', KEEP: 'k', NEW: 'n', API_KEY: 'sk-xyz-123456' });
    expect(s.posts()).toBe(1);
  });

  it('plain set_env stays R1; card mentions possible restart', async () => {
    const s = setup({});
    const { plan } = await planSetEnv(s.env, 'shop', { APP_NAME: 'x' }, {});
    expect(plan.risk).toBe(Risk.R1);
    expect(plan.impactFa).toContain('ری‌استارت');
  });

  it('values never appear in the plan, the approval card or the audit log; undo keeps previous values in the secure file', async () => {
    const s = setup({ DB_PASSWORD: 'old-db-password-1' });
    const { ctx, approver } = s.ctx(['approved']);
    await setEnv(s.env, 'shop', { DB_PASSWORD: 'new-db-password-2' }, ctx);
    const card = JSON.stringify(approver.seen[0]);
    expect(card).not.toContain('old-db-password-1');
    expect(card).not.toContain('new-db-password-2');
    const raw = readFileSync(s.audit.path, 'utf8');
    expect(raw).not.toContain('db-password');
    const [entry] = s.audit.read();
    expect(entry?.undo?.params).toMatchObject({ restore: ['DB_PASSWORD'], remove: [] });
    expect(s.audit.readUndoSecrets(entry!)).toEqual({ DB_PASSWORD: 'old-db-password-1' });
  });

  it('identical values → no-change, no approval asked', async () => {
    const s = setup({ A: '1' });
    const { ctx, approver } = s.ctx(['approved']);
    expect((await setEnv(s.env, 'shop', { A: '1' }, ctx)).status).toBe('no-change');
    expect(approver.seen).toHaveLength(0);
  });

  it('denied → nothing changes', async () => {
    const s = setup({ A: '1' });
    const { ctx } = s.ctx(['denied']);
    await expect(setEnv(s.env, 'shop', { A: '2' }, ctx)).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(s.state()).toEqual({ A: '1' });
    expect(s.posts()).toBe(0);
  });

  it('unset_env is R3 and removes only the given existing keys', async () => {
    const s = setup({ A: '1', B: '2', C: '3' });
    const { ctx, approver } = s.ctx(['approved']);
    const r = await unsetEnv(s.env, 'shop', ['B', 'MISSING'], ctx);
    expect(r.status).toBe('executed');
    expect(approver.seen[0]?.risk).toBe(Risk.R3);
    expect(approver.seen[0]?.params).toEqual({ app: 'shop', keys: ['B'] });
    expect(s.state()).toEqual({ A: '1', C: '3' });
  });

  it('dry-run shows the plan without changing anything', async () => {
    const s = setup({ A: '1' });
    const { ctx } = s.ctx(['approved']);
    const r = await setEnv(s.env, 'shop', { A: '2' }, { ...ctx, dryRun: true });
    expect(r.status).toBe('dry-run');
    expect(s.state()).toEqual({ A: '1' });
  });

  it('fingerprints bind the plan to exact values (different value → different params)', async () => {
    const s = setup({});
    const a = await planSetEnv(s.env, 'shop', { K: 'v1' }, {});
    const b = await planSetEnv(s.env, 'shop', { K: 'v2' }, {});
    expect(a.plan.params.vars).not.toEqual(b.plan.params.vars);
    expect(JSON.stringify(a.plan.params)).not.toContain('v1');
  });

  it.todo('integration with the full mock adapter (T1.16) once available');
});
