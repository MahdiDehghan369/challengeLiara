import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guard for AGENT_RULES §1.2: every REST path used under src/liara/api must be a `map` row of ENDPOINTS.md.
// spec-only rows are deliberately excluded until T0.8 confirms them (PROGRESS D-006).

const ROOT = join(import.meta.dirname, '..', '..', '..');
const normalize = (p: string) =>
  p
    .replace(/\$\{[^}]+\}/g, '{}')
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/\?.*$/, '');

function mapPaths(): Set<string> {
  const md = readFileSync(join(ROOT, 'docs', 'liara', 'ENDPOINTS.md'), 'utf8');
  const out = new Set<string>();
  for (const line of md.split('\n')) {
    const m = /^\|\s*(?:GET|POST|PUT|PATCH|DELETE)\s*\|\s*(\/[^\s|]+)\s*\|(.*)$/.exec(line.trim());
    if (!m) continue;
    const source = (m[2] ?? '').split('|').map((c) => c.trim())[3];
    if (source === 'map') out.add(normalize(m[1] as string));
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('ENDPOINTS guard', () => {
  it('src/liara/api only references endpoints listed (source=map) in ENDPOINTS.md', () => {
    const allowed = mapPaths();
    expect(allowed.size).toBeGreaterThan(30);
    const violations: string[] = [];
    let scanned = 0;
    for (const f of sourceFiles(join(ROOT, 'src', 'liara', 'api'))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/[`'"](\/v[12]\/[^`'"]*)[`'"]/g)) {
        scanned++;
        const p = normalize(m[1] as string);
        if (!allowed.has(p)) violations.push(`${f}: ${m[1]}`);
      }
    }
    expect(scanned).toBeGreaterThanOrEqual(6);
    expect(violations).toEqual([]);
  });
});
