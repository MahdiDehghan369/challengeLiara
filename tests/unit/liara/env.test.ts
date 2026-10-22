import { Writable } from 'node:stream';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EnvVar } from '../../../src/liara/cli-parsers.js';
import { diffEnv, EnvApi, type EnvCli, type EnvSemantics } from '../../../src/liara/env.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { createLogger } from '../../../src/shared/logger.js';
import { Secret } from '../../../src/shared/secret.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ev = (o: Record<string, string>): EnvVar[] => Object.entries(o).map(([key, v]) => ({ key, value: new Secret(v) }));
const plain = (vars: EnvVar[]) => Object.fromEntries(vars.map((e) => [e.key, e.value.reveal()]));

/**
 * A fake Liara holding env state; update-envs applies the given server-side semantics, so tests can
 * prove our client is safe when the real API turns out to replace the whole set.
 */
function fakeLiara(initial: Record<string, string>, serverSemantics: 'replace' | 'merge') {
  let state = { ...initial };
  const posted: Array<Record<string, string>> = [];
  const unsetCalls: string[][] = [];
  server.use(
    http.post(`${BASE}/v1/projects/update-envs`, async ({ request }) => {
      const body = (await request.json()) as { project: string; variables: Array<{ key: string; value: string }> };
      const vars = Object.fromEntries(body.variables.map((v) => [v.key, v.value]));
      posted.push(vars);
      state = serverSemantics === 'replace' ? vars : { ...state, ...vars };
      return HttpResponse.json({ message: 'ok' });
    }),
  );
  const cli: EnvCli = {
    envList: async () => ev(state),
    envUnset: async (_app, keys) => {
      unsetCalls.push(keys);
      for (const k of keys) delete state[k];
    },
  };
  return { cli, posted, unsetCalls, state: () => state };
}

const httpClient = () => new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });

describe.each<[EnvSemantics, 'replace' | 'merge']>([
  ['unknown', 'replace'],
  ['unknown', 'merge'],
  ['replace', 'replace'],
  ['merge', 'merge'],
])('EnvApi (client=%s, server=%s)', (clientMode, serverMode) => {
  it('setEnv never loses existing variables', async () => {
    const f = fakeLiara({ A: '1', B: '2' }, serverMode);
    const api = new EnvApi(httpClient(), f.cli, { semantics: clientMode });
    const r = await api.setEnv('shop', { C: '3', B: 'two' });
    expect(f.state()).toEqual({ A: '1', B: 'two', C: '3' });
    expect(plain(r.after)).toEqual({ A: '1', B: 'two', C: '3' });
    expect(r.diff).toEqual([
      { key: 'B', change: 'changed' },
      { key: 'C', change: 'added' },
    ]);
    expect(r.restartsApp).toBe('unknown');
  });

  it('unsetEnv removes only the given keys', async () => {
    const f = fakeLiara({ A: '1', B: '2', C: '3' }, serverMode);
    const api = new EnvApi(httpClient(), f.cli, { semantics: clientMode });
    const r = await api.unsetEnv('shop', ['B']);
    expect(f.state()).toEqual({ A: '1', C: '3' });
    expect(r.diff).toEqual([{ key: 'B', change: 'removed' }]);
  });
});

describe('EnvApi specifics', () => {
  it('replace/unknown mode sends the full merged set; merge mode sends only new vars', async () => {
    const f1 = fakeLiara({ A: '1' }, 'replace');
    await new EnvApi(httpClient(), f1.cli).setEnv('shop', { B: '2' });
    expect(f1.posted).toEqual([{ A: '1', B: '2' }]);

    const f2 = fakeLiara({ A: '1' }, 'merge');
    await new EnvApi(httpClient(), f2.cli, { semantics: 'merge' }).setEnv('shop', { B: '2' });
    expect(f2.posted).toEqual([{ B: '2' }]);
  });

  it('unset: replace mode posts without the keys; merge/unknown use env:unset', async () => {
    const f1 = fakeLiara({ A: '1', B: '2' }, 'replace');
    await new EnvApi(httpClient(), f1.cli, { semantics: 'replace' }).unsetEnv('shop', ['B']);
    expect(f1.posted).toEqual([{ A: '1' }]);
    expect(f1.unsetCalls).toEqual([]);

    const f2 = fakeLiara({ A: '1', B: '2' }, 'merge');
    await new EnvApi(httpClient(), f2.cli).unsetEnv('shop', ['B']);
    expect(f2.posted).toEqual([]);
    expect(f2.unsetCalls).toEqual([['B']]);
  });

  it('values are never logged or serialized', async () => {
    const lines: string[] = [];
    const log = createLogger({
      level: 'trace',
      destination: new Writable({
        write(c, _e, cb) {
          lines.push(String(c));
          cb();
        },
      }),
    });
    const f = fakeLiara({ DB_PASSWORD: 'super-secret-db-pw' }, 'replace');
    const h = new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {}, logger: log });
    const r = await new EnvApi(h, f.cli).setEnv('shop', { API_KEY: new Secret('sk-very-secret-key') });
    log.info({ result: r }, 'env changed');
    const dump = lines.join('') + JSON.stringify(r);
    expect(dump).not.toContain('super-secret-db-pw');
    expect(dump).not.toContain('sk-very-secret-key');
    expect(dump).toContain('[SECRET]');
  });

  it('rejects invalid keys before touching Liara', async () => {
    const f = fakeLiara({}, 'replace');
    await expect(new EnvApi(httpClient(), f.cli).setEnv('shop', { 'BAD KEY': 'x' })).rejects.toThrow(/invalid env key/);
    expect(f.posted).toEqual([]);
  });

  it('diffEnv', () => {
    expect(diffEnv(ev({ A: '1', B: '2' }), ev({ B: '3', C: '4' }))).toEqual([
      { key: 'A', change: 'removed' },
      { key: 'B', change: 'changed' },
      { key: 'C', change: 'added' },
    ]);
  });

  it.todo('uses the confirmed update-envs semantics and restart behavior (OQ-19) from the spike');
});
