import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { limitsByCategory } from '../../limits/catalog.js';
import { createMcpServer, type McpServerDeps } from '../../mcp/server.js';
import type { AuditEntry } from '../../safety/audit.js';

/**
 * Web panel (T9.10, simplified). The page talks to the same tool engine as the MCP server through an
 * in-memory MCP client, so it gets the same two-step approval: R1+ answers `approval_required` with a
 * one-time `confirm_token`, the page shows the plan card, and only the user's click sends it back
 * (R3 also needs the app name typed). Every API call needs the panel token.
 */

export interface WebPanelDeps extends McpServerDeps {
  readAudit?: () => AuditEntry[];
}

export interface WebPanelOptions {
  host?: string;
  port?: number;
  /** Required when the host is not loopback (e.g. on Liara). Random otherwise. */
  token?: string;
  version?: string;
}

export interface WebPanel {
  server: Server;
  url: string;
  token: string;
  close(): Promise<void>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const MAX_BODY = 64 * 1024;

export function loadPanelHtml(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, 'public', 'index.html'), join(here, '..', '..', '..', 'src', 'ui', 'web', 'public', 'index.html')]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next */
    }
  }
  return '<!doctype html><meta charset="utf-8"><p>index.html not found</p>';
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseToolText(result: { content?: unknown; isError?: unknown }): unknown {
  const first = Array.isArray(result.content) ? (result.content[0] as { type?: string; text?: string } | undefined) : undefined;
  const text = first?.type === 'text' ? (first.text ?? '') : '';
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { status: result.isError ? 'error' : 'ok', text };
  }
}

export async function startWebPanel(deps: WebPanelDeps, opts: WebPanelOptions = {}): Promise<WebPanel> {
  const host = opts.host ?? '127.0.0.1';
  if (!LOOPBACK.has(host) && !opts.token) throw new Error('SIAVASH_UI_TOKEN is required when the panel listens on a public host');
  const token = opts.token ?? randomBytes(16).toString('hex');
  const html = loadPanelHtml();

  const { server: mcp } = createMcpServer(deps);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverSide);
  const client = new Client({ name: 'siavash-web', version: opts.version ?? '0.1.0' });
  await client.connect(clientSide);

  // one tool call at a time: the MCP prompter collects notes per call
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn, fn);
    queue = p.catch(() => undefined);
    return p;
  };

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    const h = req.headers['x-siavash-token'];
    const given = (typeof h === 'string' ? h : undefined) ?? url.searchParams.get('token') ?? '';
    return given.length > 0 && sameToken(given, token);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://panel');
      try {
        if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return send(res, 200, html, 'text/html; charset=utf-8');
        if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
        if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
        if (!authorized(req, url)) return send(res, 401, { status: 'error', messageFa: 'توکن پنل نامعتبر است. آدرس کامل با ?token= را باز کنید.' });

        if (req.method === 'GET' && url.pathname === '/api/tools') {
          const t = await serial(() => client.listTools());
          return send(res, 200, { tools: t.tools.map((x) => ({ name: x.name, description: x.description, inputSchema: x.inputSchema })) });
        }
        if (req.method === 'POST' && url.pathname === '/api/call') {
          const body = await readJson(req);
          const name = typeof body.name === 'string' ? body.name : '';
          if (!/^[a-z_]{2,40}$/.test(name)) return send(res, 400, { status: 'error', messageFa: 'نام ابزار نامعتبر است.' });
          const args = body.args && typeof body.args === 'object' ? (body.args as Record<string, unknown>) : {};
          const started = Date.now();
          const r = await serial(() => client.callTool({ name, arguments: args }, undefined, { timeout: 15 * 60_000 }));
          return send(res, 200, { tool: name, ms: Date.now() - started, answer: parseToolText(r as { content?: unknown; isError?: unknown }) });
        }
        if (req.method === 'GET' && url.pathname === '/api/limits') return send(res, 200, { groups: limitsByCategory() });
        if (req.method === 'GET' && url.pathname === '/api/audit') {
          const entries = deps.readAudit ? deps.readAudit().slice(-50).reverse() : [];
          return send(res, 200, { entries });
        }
        if (req.method === 'GET' && url.pathname === '/api/info') {
          return send(res, 200, { mode: deps.liara.mode, version: opts.version ?? '0.1.0' });
        }
        return send(res, 404, { error: 'not found' });
      } catch (e) {
        return send(res, 500, { status: 'error', messageFa: 'خطای داخلی پنل', technical: e instanceof Error ? e.message.slice(0, 300) : 'unknown' });
      }
    })();
  });

  const port = opts.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return {
    server,
    token,
    url: `http://${shownHost}:${actualPort}/?token=${token}`,
    close: async () => {
      await client.close().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
