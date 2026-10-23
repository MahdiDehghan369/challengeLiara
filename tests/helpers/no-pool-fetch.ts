import { request } from 'node:http';

/**
 * `fetch` for the local mock app servers with no connection pooling at all (`agent: false`: one socket per
 * request, closed with it). Global `fetch` pools sockets per origin and silently drops a `connection: close`
 * request header (forbidden by the Fetch spec), so a pooled socket could outlive a test's server and meet
 * the next server that reuses the port — the suspected cause of the rare mock-liara probe flake on Windows.
 * Errors look like fetch's to `classifyProbeError` (Node error `code`; the abort reason on timeout).
 */
export const noKeepAlive: typeof fetch = (input, init) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const req = request(url, { method: init?.method ?? 'GET', headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : v);
        const status = res.statusCode ?? 0;
        const body = status === 204 || status === 304 || chunks.length === 0 ? null : Buffer.concat(chunks);
        resolve(new Response(body, { status, headers: h }));
      });
    });
    signal?.addEventListener('abort', () => req.destroy(signal.reason as Error), { once: true });
    req.on('error', (e) => reject(signal?.aborted ? signal.reason : e));
    req.end(typeof init?.body === 'string' ? init.body : undefined);
  });
