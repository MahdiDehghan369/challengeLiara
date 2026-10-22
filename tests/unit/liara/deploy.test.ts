import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DeployApi, type ReleaseSignal } from '../../../src/liara/api/deploy.js';
import { LiaraHttp } from '../../../src/liara/http.js';
import { LiaraApiError } from '../../../src/shared/errors.js';

const BASE = 'https://api.liara.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const api = () => new DeployApi(new LiaraHttp({ token: 't', baseUrl: BASE, sleep: async () => {} }));

function fakeArchive(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'siavash-up-'));
  const p = join(dir, 'source.tar.gz');
  writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

describe('DeployApi.uploadSource', () => {
  it('uploads the archive as multipart field `file` and reports percent progress', async () => {
    let received: { name?: string; size?: number; type?: string | null } = {};
    server.use(
      http.post(`${BASE}/v2/projects/shop-api/sources`, async ({ request }) => {
        received.type = request.headers.get('content-type');
        const form = await request.formData();
        const f = form.get('file');
        if (f instanceof File) received = { ...received, name: f.name, size: f.size };
        return HttpResponse.json({ sourceID: 'src-123' });
      }),
    );
    const progress: number[] = [];
    const id = await api().uploadSource('shop-api', fakeArchive(1_000_000), (pct) => progress.push(pct));
    expect(id).toBe('src-123');
    expect(received.name).toBe('source.tar.gz');
    expect(received.size).toBe(1_000_000);
    expect(received.type).toMatch(/^multipart\/form-data; boundary=/);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[progress.length - 1]).toBe(100);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('upload is not retried on failure', async () => {
    let calls = 0;
    server.use(
      http.post(`${BASE}/v2/projects/a/sources`, () => {
        calls++;
        return new HttpResponse(null, { status: 503 });
      }),
    );
    await expect(api().uploadSource('a', fakeArchive(10))).rejects.toBeInstanceOf(LiaraApiError);
    expect(calls).toBe(1);
  });
});

describe('DeployApi.createRelease', () => {
  it('posts {sourceID, port, type} and returns releaseID', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/v2/projects/shop-api/releases`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ releaseID: 'rel-9' });
      }),
    );
    expect(await api().createRelease('shop-api', { sourceID: 'src-123', port: 3000, type: 'node' })).toBe('rel-9');
    expect(body).toEqual({ sourceID: 'src-123', port: 3000, type: 'node' });
  });
});

describe('DeployApi.waitForRelease', () => {
  const sig = (name: string, seq: Array<'success' | 'failed' | 'pending'>): ReleaseSignal => {
    let i = 0;
    return {
      name,
      check: async () => {
        const verdict = seq[Math.min(i, seq.length - 1)] as 'success' | 'failed' | 'pending';
        i++;
        return { verdict, evidence: `${name}#${i}=${verdict}` };
      },
    };
  };
  const fast = { intervalMs: 10, sleep: async () => {} };

  it('success once a signal reports success', async () => {
    const r = await api().waitForRelease('a', 'rel', { ...fast, signals: [sig('probe', ['pending', 'success'])] });
    expect(r.result).toBe('success');
    expect(r.evidence).toEqual(['probe: probe#1=pending', 'probe: probe#2=success']);
  });

  it('failed wins over success in the same round', async () => {
    const r = await api().waitForRelease('a', 'rel', {
      ...fast,
      signals: [sig('probe', ['success']), sig('logs', ['failed'])],
    });
    expect(r.result).toBe('failed');
  });

  it('timeout when nothing decides; signal errors are recorded as evidence', async () => {
    let t = 0;
    const r = await api().waitForRelease('a', 'rel', {
      timeoutMs: 100,
      intervalMs: 30,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
      signals: [
        sig('events', ['pending']),
        {
          name: 'broken',
          check: async () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(r.result).toBe('timeout');
    expect(r.evidence).toContain('broken: error boom');
  });

  it.todo('uses the confirmed build-finished signal (OQ-15) once BEHAVIOR §3 is known');
});
