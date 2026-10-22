import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { MockLiaraState } from './state.js';

/**
 * Local stand-in for `https://<app>.liara.run` (T1.16): one HTTP server per app on 127.0.0.1, answering
 * according to the app's state and scenario (stopped → 503, crashing → 502, http-500 → 500, slow → delay).
 */
export class MockAppServers {
  private readonly servers = new Map<string, { server: Server; url: string }>();

  constructor(private readonly state: MockLiaraState) {}

  /** Base URL serving `app` (started on first use). */
  async urlFor(app: string): Promise<string> {
    const existing = this.servers.get(app);
    if (existing) return existing.url;
    const server = createServer((req, res) => {
      const a = this.state.apps.get(app);
      const path = (req.url ?? '/').split('?')[0] as string;
      const b = a ? this.state.httpBehaviour(a, path) : { status: 404, body: 'Not Found', delayMs: 0 };
      setTimeout(() => {
        // no keep-alive: servers come and go per test and ports get reused, so pooled sockets would go stale
        res.writeHead(b.status, { 'content-type': b.body.startsWith('{') ? 'application/json' : 'text/plain', connection: 'close' });
        res.end(b.body);
      }, b.delayMs);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    this.servers.set(app, { server, url });
    return url;
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.servers.values()].map(
        ({ server }) =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      ),
    );
    this.servers.clear();
  }
}
