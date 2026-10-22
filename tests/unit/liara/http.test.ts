import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiaraHttp, parseRetryAfter } from '../../../src/liara/http.js';
import { LiaraApiError, RateLimitError, ValidationError } from '../../../src/shared/errors.js';
import { fa } from '../../../src/ui/cli/i18n/fa.js';

const BASE = 'https://api.liara.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const sleeps: number[] = [];
function client(extra: Partial<ConstructorParameters<typeof LiaraHttp>[0]> = {}) {
  sleeps.length = 0;
  return new LiaraHttp({
    token: 'test-token',
    baseUrl: BASE,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
}

describe('LiaraHttp', () => {
  it('GET success: sends bearer token, query, and validates with zod (string → number)', async () => {
    let auth: string | null = null;
    let since: string | null = null;
    server.use(
      http.get(`${BASE}/v1/projects/app/metrics/cpu`, ({ request }) => {
        auth = request.headers.get('authorization');
        since = new URL(request.url).searchParams.get('since');
        return HttpResponse.json({ end: '1700000000' });
      }),
    );
    const data = await client().get('/v1/projects/app/metrics/cpu', {
      query: { since: 3600, unused: undefined },
      schema: z.object({ end: z.coerce.number() }),
    });
    expect(data).toEqual({ end: 1_700_000_000 });
    expect(auth).toBe('Bearer test-token');
    expect(since).toBe('3600');
  });

  it('404 → LiaraApiError NOT_FOUND with Persian message', async () => {
    server.use(http.get(`${BASE}/v1/x`, () => HttpResponse.json({ message: 'nope' }, { status: 404 })));
    const e = await client()
      .get('/v1/x', { operationId: 'x.get' })
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LiaraApiError);
    const le = e as LiaraApiError;
    expect(le.status).toBe(404);
    expect(le.code).toBe('NOT_FOUND');
    expect(le.operationId).toBe('x.get');
    expect(le.messageFa).toBe(fa.liaraHttp.notFound);
    expect(le.details.remoteMessage).toBe('nope');
  });

  it('401 → "Liara token is invalid or expired"', async () => {
    server.use(http.get(`${BASE}/v1/projects`, () => new HttpResponse(null, { status: 401 })));
    const e = (await client()
      .get('/v1/projects')
      .catch((x: unknown) => x)) as LiaraApiError;
    expect(e.status).toBe(401);
    expect(e.messageFa).toBe('توکن لیارا نامعتبر یا منقضی است.');
  });

  it('409 on POST → CONFLICT, not retried', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/v1/projects`, () => {
        calls++;
        return HttpResponse.json({ message: 'exists' }, { status: 409 });
      }),
    );
    const e = (await client()
      .post('/v1/projects', { body: { name: 'a' } })
      .catch((x: unknown) => x)) as LiaraApiError;
    expect(e.code).toBe('CONFLICT');
    expect(e.messageFa).toBe(fa.liaraHttp.conflict);
    expect(calls).toBe(1);
  });

  it('429 with Retry-After: GET waits the given time, then succeeds', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/projects`, () => {
        calls++;
        return calls === 1
          ? new HttpResponse(null, { status: 429, headers: { 'retry-after': '2' } })
          : HttpResponse.json({ projects: [] });
      }),
    );
    const c = client();
    expect(await c.get('/v1/projects')).toEqual({ projects: [] });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(c.getStats()).toMatchObject({ requests: 2, retries: 1, rateLimited: 1, errors: 0 });
  });

  it('429 persisting → RateLimitError after 3 retries', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/projects`, () => {
        calls++;
        return new HttpResponse(null, { status: 429, headers: { 'retry-after': '1' } });
      }),
    );
    const c = client();
    const e = await c.get('/v1/projects').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RateLimitError);
    expect((e as RateLimitError).retryAfterMs).toBe(1000);
    expect(calls).toBe(4);
    expect(c.getStats().rateLimited).toBe(4);
  });

  it('retries GET on 503 with exponential backoff', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/v1/projects`, () => {
        calls++;
        return calls < 3 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ ok: 1 });
      }),
    );
    await client().get('/v1/projects');
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(500);
    expect(sleeps[1]).toBeGreaterThanOrEqual(1000);
  });

  it('never retries POST/DELETE, even on 503 or 429', async () => {
    let posts = 0;
    let deletes = 0;
    server.use(
      http.post(`${BASE}/v1/projects/a/actions/restart`, () => {
        posts++;
        return new HttpResponse(null, { status: 503 });
      }),
      http.delete(`${BASE}/v1/projects/a`, () => {
        deletes++;
        return new HttpResponse(null, { status: 429 });
      }),
    );
    const c = client();
    await expect(c.post('/v1/projects/a/actions/restart')).rejects.toBeInstanceOf(LiaraApiError);
    await expect(c.delete('/v1/projects/a')).rejects.toBeInstanceOf(RateLimitError);
    expect(posts).toBe(1);
    expect(deletes).toBe(1);
    expect(c.getStats().retries).toBe(0);
  });

  it('timeout → LiaraApiError TIMEOUT', async () => {
    server.use(
      http.get(`${BASE}/v1/slow`, async () => {
        await delay(500);
        return HttpResponse.json({});
      }),
    );
    const e = (await client({ maxRetries: 0 })
      .get('/v1/slow', { timeoutMs: 50 })
      .catch((x: unknown) => x)) as LiaraApiError;
    expect(e).toBeInstanceOf(LiaraApiError);
    expect(e.code).toBe('TIMEOUT');
    expect(e.messageFa).toBe(fa.liaraHttp.timeout);
  });

  it('empty 200/204 body → { accepted: true }', async () => {
    server.use(
      http.post(`${BASE}/v1/projects/a/actions/restart`, () => new HttpResponse(null, { status: 200 })),
      http.delete(`${BASE}/v1/projects/a`, () => new HttpResponse(null, { status: 204 })),
    );
    const c = client();
    expect(await c.post('/v1/projects/a/actions/restart')).toEqual({ accepted: true });
    expect(await c.delete('/v1/projects/a')).toEqual({ accepted: true });
  });

  it('schema mismatch → ValidationError', async () => {
    server.use(http.get(`${BASE}/v1/projects`, () => HttpResponse.json({ projects: 'nope' })));
    await expect(
      client().get('/v1/projects', { schema: z.object({ projects: z.array(z.unknown()) }) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('multipart upload sends the file as form-data', async () => {
    let fileName: string | undefined;
    let size = 0;
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/v2/projects/a/sources`, async ({ request }) => {
        contentType = request.headers.get('content-type');
        const form = await request.formData();
        const f = form.get('file');
        if (f instanceof File) {
          fileName = f.name;
          size = f.size;
        }
        return HttpResponse.json({ sourceID: 'src-1' });
      }),
    );
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([1, 2, 3, 4])]), 'source.tar.gz');
    const res = await client().post('/v2/projects/a/sources', {
      multipart: form,
      schema: z.object({ sourceID: z.string() }),
    });
    expect(res.sourceID).toBe('src-1');
    expect(fileName).toBe('source.tar.gz');
    expect(size).toBe(4);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('sends teamID as query param by default, or as header when configured', async () => {
    const seen: Array<{ q: string | null; h: string | null }> = [];
    server.use(
      http.get(`${BASE}/v1/projects`, ({ request }) => {
        seen.push({ q: new URL(request.url).searchParams.get('teamID'), h: request.headers.get('teamID') });
        return HttpResponse.json({});
      }),
    );
    await client({ teamId: 'team-1' }).get('/v1/projects');
    await client({ teamId: 'team-1', teamIdMode: 'header' }).get('/v1/projects');
    await client().get('/v1/projects');
    expect(seen).toEqual([
      { q: 'team-1', h: null },
      { q: null, h: 'team-1' },
      { q: null, h: null },
    ]);
  });

  it('parseRetryAfter handles seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:10 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(
      10_000,
    );
  });
});
