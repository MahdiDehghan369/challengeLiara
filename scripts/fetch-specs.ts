/**
 * T0.1 — Downloads Liara's public OpenAPI specs + two doc pages into specs/, then writes
 * docs/liara/SPEC_DIFF.md comparing specs/paas.yaml with docs/liara/ENDPOINTS.md and
 * summarizing dbaas/me/billing/dns endpoints.
 *
 * Usage: pnpm tsx scripts/fetch-specs.ts [--offline]
 *   --offline  skip downloading; diff whatever is already in specs/
 * Public docs only — no Liara API token is used.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const SPEC_BASE = 'https://developers.liara.ir/spec';
const SPECS = ['paas', 'billing', 'me', 'dbaas', 'dns'] as const;
const PAGES = [
  'https://developers.liara.ir/pass/apps/get-applets-of-app.md',
  'https://developers.liara.ir/pass/domains/check-a-domain.md',
];
const SPECS_DIR = 'specs';
const ENDPOINTS_MD = 'docs/liara/ENDPOINTS.md';
const SPEC_DIFF_MD = 'docs/liara/SPEC_DIFF.md';
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type Json = Record<string, unknown>;
interface Operation {
  method: string;
  path: string;
  summary: string;
  responseFields: string[];
  requestFields: string[];
}

async function download(url: string, dest: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return `HTTP ${res.status}`;
    writeFileSync(dest, await res.text(), 'utf8');
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function normalizePath(p: string): string {
  return p.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '');
}

function resolveRef(doc: Json, node: unknown, seen = new Set<string>()): Json | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const ref = (node as Json).$ref;
  if (typeof ref === 'string') {
    if (seen.has(ref)) return undefined;
    seen.add(ref);
    let cur: unknown = doc;
    for (const part of ref.replace(/^#\//, '').split('/')) cur = (cur as Json | undefined)?.[part];
    return resolveRef(doc, cur, seen);
  }
  return node as Json;
}

/** Collects dotted property names of a schema (depth-limited), following $ref/allOf/items. */
function schemaFields(doc: Json, schema: unknown, prefix = '', depth = 0): string[] {
  const s = resolveRef(doc, schema);
  if (!s || depth > 3) return [];
  const out: string[] = [];
  for (const key of ['allOf', 'oneOf', 'anyOf'] as const) {
    const list = s[key];
    if (Array.isArray(list)) for (const sub of list) out.push(...schemaFields(doc, sub, prefix, depth));
  }
  if (s.items) out.push(...schemaFields(doc, s.items, `${prefix}[]`, depth + 1));
  const props = s.properties;
  if (props && typeof props === 'object') {
    for (const [k, v] of Object.entries(props as Json)) {
      const name = prefix ? `${prefix}.${k}` : k;
      out.push(name);
      out.push(...schemaFields(doc, v, name, depth + 1));
    }
  }
  return out;
}

function jsonSchemaOf(doc: Json, container: unknown): unknown {
  const c = resolveRef(doc, container);
  const content = c?.content as Json | undefined;
  if (!content) return undefined;
  const media = (content['application/json'] ?? content['multipart/form-data'] ?? Object.values(content)[0]) as
    | Json
    | undefined;
  return media?.schema;
}

function operations(doc: Json): Operation[] {
  const ops: Operation[] = [];
  const paths = (doc.paths ?? {}) as Json;
  for (const [path, item] of Object.entries(paths)) {
    for (const m of HTTP_METHODS) {
      const op = (item as Json)[m] as Json | undefined;
      if (!op) continue;
      const responses = (op.responses ?? {}) as Json;
      const okKey = Object.keys(responses).find((k) => k.startsWith('2'));
      ops.push({
        method: m.toUpperCase(),
        path,
        summary: String(op.summary ?? op.operationId ?? ''),
        responseFields: okKey ? schemaFields(doc, jsonSchemaOf(doc, responses[okKey])) : [],
        requestFields: schemaFields(doc, jsonSchemaOf(doc, op.requestBody)),
      });
    }
  }
  return ops;
}

export function endpointsFromMarkdown(md: string): Array<{ method: string; path: string; source: string }> {
  const rows: Array<{ method: string; path: string; source: string }> = [];
  for (const line of md.split('\n')) {
    const m = /^\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\/[^\s|]+)\s*\|(.*)$/.exec(line.trim());
    if (!m) continue;
    const cells = (m[3] ?? '').split('|').map((c) => c.trim());
    rows.push({ method: m[1] as string, path: m[2] as string, source: cells[3] ?? '' });
  }
  return rows;
}

function cell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function opTable(ops: Operation[], withFields: boolean): string {
  if (ops.length === 0) return '_(spec not available)_\n';
  const head = withFields
    ? '| Method | Path | Summary | Request fields | 2xx response fields |\n|---|---|---|---|---|\n'
    : '| Method | Path | Summary |\n|---|---|---|\n';
  return (
    head +
    ops
      .map((o) =>
        withFields
          ? `| ${o.method} | \`${o.path}\` | ${cell(o.summary)} | ${cell(o.requestFields.join(', '))} | ${cell(o.responseFields.join(', '))} |`
          : `| ${o.method} | \`${o.path}\` | ${cell(o.summary)} |`,
      )
      .join('\n') +
    '\n'
  );
}

async function main(): Promise<void> {
  const offline = process.argv.includes('--offline');
  mkdirSync(join(SPECS_DIR, 'pages'), { recursive: true });
  const errors: string[] = [];

  if (!offline) {
    for (const s of SPECS) {
      const e = await download(`${SPEC_BASE}/${s}.yaml`, join(SPECS_DIR, `${s}.yaml`));
      if (e) errors.push(`${s}.yaml: ${e}`);
    }
    for (const url of PAGES) {
      const e = await download(url, join(SPECS_DIR, 'pages', url.split('/').slice(-2).join('__')));
      if (e) errors.push(`${url}: ${e}`);
    }
  }

  const docs: Partial<Record<(typeof SPECS)[number], Json>> = {};
  for (const s of SPECS) {
    const p = join(SPECS_DIR, `${s}.yaml`);
    if (!existsSync(p)) continue;
    try {
      docs[s] = parse(readFileSync(p, 'utf8')) as Json;
    } catch (e) {
      errors.push(`${s}.yaml parse: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const mapped = endpointsFromMarkdown(readFileSync(ENDPOINTS_MD, 'utf8'));
  const mapKeys = new Set(mapped.filter((r) => r.source === 'map').map((r) => `${r.method} ${normalizePath(r.path)}`));
  const paasOps = docs.paas ? operations(docs.paas) : [];
  const specKeys = new Map(paasOps.map((o) => [`${o.method} ${normalizePath(o.path)}`, o]));

  // A map row is "covered" if any downloaded spec (paas, billing, ...) defines it.
  const allSpecKeys = new Set(
    Object.values(docs).flatMap((d) => operations(d).map((o) => `${o.method} ${normalizePath(o.path)}`)),
  );
  const specOnly = [...specKeys.entries()].filter(([k]) => !mapKeys.has(k)).map(([, o]) => o);
  const mapOnly = [...mapKeys].filter((k) => !allSpecKeys.has(k));

  const out: string[] = [];
  out.push('# SPEC_DIFF — `specs/paas.yaml` vs `ENDPOINTS.md`\n');
  out.push(`> Generated by \`pnpm tsx scripts/fetch-specs.ts\` on ${new Date().toISOString()}. Do not edit by hand.\n`);
  out.push(
    `paas.yaml operations: **${paasOps.length}** · ENDPOINTS.md (map) REST rows: **${mapKeys.size}** · spec-only: **${specOnly.length}** · map-only: **${mapOnly.length}**\n`,
  );
  if (errors.length) out.push(`## Download / parse errors\n\n${errors.map((e) => `- ${e}`).join('\n')}\n`);
  out.push('## In spec, not in map (`spec-only`)\n');
  out.push(specOnly.length ? opTable(specOnly, true) : '_(none)_\n');
  out.push('## In map, not in any downloaded spec\n');
  out.push(mapOnly.length ? mapOnly.map((k) => `- \`${k}\``).join('\n') + '\n' : '_(none)_\n');
  out.push('## dbaas.yaml (databases)\n');
  out.push(opTable(docs.dbaas ? operations(docs.dbaas) : [], true));
  out.push('## me.yaml (user / team)\n');
  out.push(opTable(docs.me ? operations(docs.me) : [], true));
  out.push('## billing.yaml\n');
  out.push(opTable(docs.billing ? operations(docs.billing) : [], true));
  out.push('## dns.yaml\n');
  out.push(opTable(docs.dns ? operations(docs.dns) : [], false));
  writeFileSync(SPEC_DIFF_MD, out.join('\n'), 'utf8');

  console.log(`specs: ${Object.keys(docs).join(', ') || 'none'}`);
  console.log(`paas ops=${paasOps.length} map=${mapKeys.size} spec-only=${specOnly.length} map-only=${mapOnly.length}`);
  if (errors.length) console.log(`errors:\n  ${errors.join('\n  ')}`);
  console.log(`wrote ${SPEC_DIFF_MD}`);
}

await main();
