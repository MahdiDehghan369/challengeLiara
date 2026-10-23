import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLiaraClient } from '../../../src/liara/index.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const KEYS = ['apps', 'metrics', 'logs', 'events', 'deploy', 'ledger', 'env', 'settings', 'billing', 'account', 'disks', 'domains', 'db', 'console', 'cli', 'stats'] as const;

const mockConfig = { liara: { token: undefined, teamId: undefined, mode: 'mock' as const }, dataDir: join(ROOT, '.siavash-test') };

describe('createLiaraClient', () => {
  it('mock mode: every submodule is defined and wired to the fake Liara', async () => {
    const c = createLiaraClient(mockConfig, { mockOptions: { asyncDelayMs: 1 } });
    for (const k of KEYS) expect(c[k], k).toBeDefined();
    expect(c.mode).toBe('mock');
    expect(c.mock?.state).toBeDefined();

    await c.apps.createApp({ name: 'shop', planID: 'small-g2', platform: 'node' });
    expect(c.mock?.state.apps.has('shop')).toBe(true);
    await c.env.setEnv('shop', { APP_NAME: 'shop' });
    expect((await c.env.listEnv('shop')).map((e) => e.key)).toEqual(['APP_NAME']);
    expect((await c.billing.getBilling()).balanceToman).toBeGreaterThan(0);
    expect(await c.account.getMe()).toEqual({ tokenValid: true, appCount: 1 });
    expect((await c.console.runInContainer('shop', 'pwd')).stdout).toBe('/app');
    expect(c.stats().requests).toBeGreaterThan(0);
    await c.mock?.servers.close();
  });

  it('onRequest hook sees every HTTP attempt', async () => {
    const ops: string[] = [];
    const c = createLiaraClient(mockConfig, { onRequest: (op) => ops.push(op) });
    await c.apps.listApps();
    expect(ops).toEqual(['apps.list']);
  });

  it('live mode: no mock attached, nothing called at construction', () => {
    const c = createLiaraClient({ liara: { token: 'live-token-123456', teamId: undefined, mode: 'live' }, dataDir: '.siavash' });
    expect(c.mode).toBe('live');
    expect(c.mock).toBeUndefined();
    expect(c.stats().requests).toBe(0);
  });
});

// eslint 8 ships no type declarations; only the bit used here is typed
interface LintMessage {
  ruleId: string | null;
}
type ESLintCtor = new (o: { cwd: string }) => {
  lintText(code: string, o: { filePath: string }): Promise<Array<{ messages: LintMessage[] }>>;
};
const { ESLint } = createRequire(import.meta.url)('eslint') as { ESLint: ESLintCtor };

// the first lintText loads eslint + the typescript-eslint parser + TypeScript: ~11 s alone and over 30 s under
// the full parallel suite on WSL's /mnt/c filesystem (I/O bound, measured 2026-10-23)
describe('no-restricted-imports (T1.17)', { timeout: 120_000 }, () => {
  const eslint = new ESLint({ cwd: ROOT });
  const lint = async (filePath: string, code: string) =>
    (await eslint.lintText(code, { filePath: join(ROOT, filePath) }))[0]?.messages.filter((m) => m.ruleId === 'no-restricted-imports') ?? [];

  it('modules outside src/liara cannot import liara/api or liara/mock', async () => {
    expect(await lint('src/ops/x.ts', "import type { App } from '../liara/api/schemas/apps.js';\nexport type X = App;\n")).toHaveLength(1);
    expect(await lint('src/sre/x.ts', "import { MockLiaraState } from '../liara/mock/state.js';\nexport const s = MockLiaraState;\n")).toHaveLength(1);
  });

  it('the barrel and src/liara internals are allowed', async () => {
    expect(await lint('src/ops/x.ts', "import type { App } from '../liara/index.js';\nexport type X = App;\n")).toHaveLength(0);
    expect(await lint('src/liara/x.ts', "import type { App } from './api/schemas/apps.js';\nexport type X = App;\n")).toHaveLength(0);
  });
});
