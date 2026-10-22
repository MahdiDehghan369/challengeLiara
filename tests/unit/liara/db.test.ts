import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { DbCreateInput, RunResult } from '../../../src/liara/cli.js';
import { buildConnectionString, DbApi, normalizeDbKind, type DbCli } from '../../../src/liara/db.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { Secret } from '../../../src/shared/secret.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ok: RunResult = { stdout: '', stderr: '', exitCode: 0 };
function mockCli() {
  const calls: Array<[string, unknown[]]> = [];
  const rec =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, args]);
      return ok;
    };
  const cli: DbCli = {
    dbCreate: rec('dbCreate') as (i: DbCreateInput) => Promise<RunResult>,
    dbList: async () => {
      calls.push(['dbList', []]);
      return [{ name: 'shop-db' }];
    },
    dbStart: rec('dbStart'),
    dbStop: rec('dbStop'),
    dbResize: rec('dbResize'),
    dbRemove: rec('dbRemove'),
  };
  return { cli, calls };
}

const httpClient = () => new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });

describe('DbApi lifecycle (CLI)', () => {
  it('delegates to the CLI; create defaults publicNetwork to false', async () => {
    const { cli, calls } = mockCli();
    const db = new DbApi(cli, httpClient());
    await db.createDb({ name: 'shop-db', type: 'postgres', plan: 'p1' });
    expect(await db.listDbs()).toEqual([{ name: 'shop-db' }]);
    await db.startDb('shop-db');
    await db.stopDb('shop-db');
    await db.resizeDb('shop-db', 'p2');
    await db.removeDb('shop-db');
    expect(calls).toEqual([
      ['dbCreate', [{ publicNetwork: false, name: 'shop-db', type: 'postgres', plan: 'p1' }]],
      ['dbList', []],
      ['dbStart', ['shop-db']],
      ['dbStop', ['shop-db']],
      ['dbResize', ['shop-db', 'p2', {}]],
      ['dbRemove', ['shop-db']],
    ]);
  });
});

describe('getDbConnection', () => {
  it('reads connection info from the dbaas endpoints; password stays a Secret', async () => {
    server.use(
      http.get(`${BASE}/v1/databases`, () =>
        HttpResponse.json({ databases: [{ id: 'db-1', hostname: 'shop-db', type: 'postgres' }] }),
      ),
      http.get(`${BASE}/v1/databases/db-1`, () =>
        HttpResponse.json({
          database: {
            type: 'postgres',
            hostname: 'shop-db',
            internalPort: 5432,
            port: 31234,
            publicNetwork: false,
            node: { host: 'n1.example' },
            root_password: 'pg-root-pw-xyz',
            username: 'root',
            dbName: 'shop',
          },
        }),
      ),
    );
    const c = await new DbApi(mockCli().cli, httpClient()).getDbConnection('shop-db');
    expect(c.status).toBe('ok');
    if (c.status !== 'ok') return;
    expect(c.internal).toEqual({ host: 'shop-db', port: 5432 });
    expect(c.public).toBeUndefined();
    expect(c.password).toBeInstanceOf(Secret);
    expect(JSON.stringify(c)).not.toContain('pg-root-pw-xyz');
    expect(c.connectionString?.reveal()).toBe('postgresql://root:pg-root-pw-xyz@shop-db:5432/shop');
  });

  it('falls back to needs-human when the db is not listed or the API fails', async () => {
    server.use(http.get(`${BASE}/v1/databases`, () => HttpResponse.json({ databases: [] })));
    const api = new DbApi(mockCli().cli, httpClient());
    const c1 = await api.getDbConnection('missing');
    expect(c1.status).toBe('needs-human');
    if (c1.status === 'needs-human') expect(c1.instructionFa).toContain('missing');

    server.use(http.get(`${BASE}/v1/databases`, () => new HttpResponse(null, { status: 404 })));
    expect((await api.getDbConnection('x')).status).toBe('needs-human');
  });

  it.todo('confirm dbaas details endpoint + hostname↔name mapping in production (OQ-12)');
});

describe('buildConnectionString', () => {
  const pw = new Secret('p@ss:w/rd');
  it.each([
    ['postgres', 'postgresql://u:p%40ss%3Aw%2Frd@h:5432/app'],
    ['mysql', 'mysql://u:p%40ss%3Aw%2Frd@h:5432/app'],
    ['mongodb', 'mongodb://u:p%40ss%3Aw%2Frd@h:5432/app?authSource=admin'],
  ] as const)('%s (password URL-encoded)', (kind, expected) => {
    expect(buildConnectionString(kind, { host: 'h', port: 5432, user: 'u', password: pw, database: 'app' }).reveal()).toBe(
      expected,
    );
  });

  it('falls back to the default port; result serializes as [SECRET]', () => {
    const s = buildConnectionString('mongodb', { host: 'h', port: 0, user: 'u', password: pw });
    expect(s.reveal()).toBe('mongodb://u:p%40ss%3Aw%2Frd@h:27017/?authSource=admin');
    expect(JSON.stringify({ s })).toBe('{"s":"[SECRET]"}');
  });

  it('normalizeDbKind', () => {
    expect(normalizeDbKind('PostgreSQL')).toBe('postgres');
    expect(normalizeDbKind('mongodb')).toBe('mongodb');
    expect(normalizeDbKind('redis')).toBeUndefined();
  });
});
