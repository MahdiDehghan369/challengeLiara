import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LiaraHttp } from '../../../src/liara/http.js';
import { MetricsApi } from '../../../src/liara/api/metrics.js';
import { METRIC_KINDS } from '../../../src/liara/api/schemas/metrics.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const h = () => new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} });

describe('MetricsApi', () => {
  it('normalizes the summary', async () => {
    server.use(
      http.get(`${BASE}/v1/projects/shop-api/metrics/summary`, () =>
        HttpResponse.json(loadFixture('metrics.summary.json')),
      ),
    );
    const s = await new MetricsApi(h()).getSummary('shop-api');
    expect(s.cpu).toEqual([{ applet: 'shop-api-7c9d8f-abcde', value: 0.125, ts: 1760000000 }]);
    expect(s.memory[0]?.value).toBe(157286400);
    expect(s.disks).toEqual([{ name: 'uploads', sizeRaw: '1', usageRaw: '0.25', reportedAt: '2026-10-20T12:00:00.000Z' }]);
  });

  it('tolerates missing summary arrays', async () => {
    server.use(http.get(`${BASE}/v1/projects/a/metrics/summary`, () => HttpResponse.json({})));
    expect(await new MetricsApi(h()).getSummary('a')).toEqual({ cpu: [], memory: [], disks: [] });
  });

  it('parses a series, converts strings to numbers, drops and counts NaN points', async () => {
    let since: string | null = null;
    server.use(
      http.get(`${BASE}/v1/projects/shop-api/metrics/cpu`, ({ request }) => {
        since = new URL(request.url).searchParams.get('since');
        return HttpResponse.json(loadFixture('metrics.cpu.json'));
      }),
    );
    const api = new MetricsApi(h(), { now: () => 1_760_003_600 });
    const r = await api.getSeries('shop-api', 'cpu', 3600);
    expect(since).toBe('1760000000');
    expect(r.kind).toBe('cpu');
    expect(r.unit).toBe('unknown');
    expect(r.end).toBe(1760003600);
    expect(r.dropped).toBe(2);
    expect(r.series[0]?.points).toEqual([
      { ts: 1760000000, value: 0.1 },
      { ts: 1760000060, value: 0.12 },
      { ts: 1760000180, value: 0.2 },
    ]);
  });

  it('since conversion: absolute (default) vs relative', () => {
    expect(new MetricsApi(h(), { now: () => 10_000 }).toSince(3600)).toBe(6400);
    expect(new MetricsApi(h(), { sinceMode: 'relative' }).toSince(3600)).toBe(3600);
  });

  it.each(METRIC_KINDS)('hits /metrics/%s', async (kind) => {
    let hit = false;
    server.use(
      http.get(`${BASE}/v1/projects/a/metrics/${kind}`, () => {
        hit = true;
        return HttpResponse.json({ end: 1, result: [] });
      }),
    );
    const r = await new MetricsApi(h()).getSeries('a', kind, 60);
    expect(hit).toBe(true);
    expect(r.series).toEqual([]);
  });

  it.todo('uses the confirmed since format (OQ-2) — replace the default once BEHAVIOR §6 is known');
  it.todo('reports real CPU/RAM units (OQ-3) once BEHAVIOR §6 is known');
});
