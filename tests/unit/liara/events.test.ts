import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { classifyEvent, EventsApi, parseEventRow } from '../../../src/liara/api/events.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { loadFixture } from '../../helpers/fixtures.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const api = () => new EventsApi(new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} }));

describe('EventsApi.getEvents', () => {
  it('parses the fixture without errors, sorted oldest first; unknown rows survive', async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get(`${BASE}/v1/projects/shop-api/events`, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(loadFixture('events.json'));
      }),
    );
    const events = await api().getEvents('shop-api', { start: 1760961000.7, end: 1760962000, search: '' });
    expect(query?.get('start')).toBe('1760961000');
    expect(query?.get('end')).toBe('1760962000');
    expect(query?.has('search')).toBe(false);
    expect(events.map((e) => [e.kind, e.ts])).toEqual([
      ['deploy', 1760961600000],
      ['crash', 1760961660000],
      ['oom', 1760961720000],
      ['restart', 1760961780000],
      ['config', 1760961840000],
      ['scale', Date.parse('2026-10-20T12:05:00Z')],
      ['unknown', undefined],
    ]);
    const oom = events.find((e) => e.kind === 'oom');
    expect(oom?.message).toBe('container exceeded memory limit');
    expect(oom?.meta.type).toBe('OOMKilled');
    expect(events.at(-1)).toMatchObject({ message: 'SYNTHETIC_UNKNOWN_SHAPE', raw: ['SYNTHETIC_UNKNOWN_SHAPE'] });
  });

  it('tolerates missing/null values and metaData and non-string items', async () => {
    server.use(
      http.get(`${BASE}/v1/projects/shop-api/events`, () =>
        HttpResponse.json({ data: [{ metaData: null, values: null }, { values: [[1760961600, { a: 1 }], []] }] }),
      ),
    );
    const events = await api().getEvents('shop-api');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ ts: 1760961600000, kind: 'unknown', message: '{"a":1}' });
    expect(events[1]).toMatchObject({ ts: undefined, kind: 'unknown', message: '' });
  });

  it.todo('OQ-6: parse the recorded events fixture (row layout, event texts) once T0.8 records it');

  it('passes search through', async () => {
    let search: string | null = null;
    server.use(
      http.get(`${BASE}/v1/projects/shop-api/events`, ({ request }) => {
        search = new URL(request.url).searchParams.get('search');
        return HttpResponse.json({ data: [] });
      }),
    );
    expect(await api().getEvents('shop-api', { search: 'deploy' })).toEqual([]);
    expect(search).toBe('deploy');
  });
});

describe('classifyEvent / parseEventRow', () => {
  it.each([
    ['OOMKilled', 'oom'],
    ['Container ran out of memory', 'oom'],
    ['CrashLoopBackOff', 'crash'],
    ['Process exited with code 1', 'crash'],
    ['Liveness probe failed', 'crash'],
    ['New release deployed', 'deploy'],
    ['Build finished', 'deploy'],
    ['App restarted', 'restart'],
    ['App stopped', 'restart'],
    ['Scaled to 1 replica', 'scale'],
    ['Plan changed to pro', 'config'],
    ['Domain shop.ir attached', 'config'],
    ['something else', 'unknown'],
  ])('%s → %s', (text, kind) => {
    expect(classifyEvent(text)).toBe(kind);
  });

  it('group metaData counts toward classification and is kept in meta', () => {
    const e = parseEventRow(['1760961600', 'container event'], { reason: 'OOMKilled' });
    expect(e.kind).toBe('oom');
    expect(e.meta).toEqual({ reason: 'OOMKilled' });
  });
});
