import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'fixtures', 'liara');

/** Loads a fixture: prefers a recorded one (`fixtures/liara/<name>`), else the spec-derived one (`spec/<name>`). */
export function loadFixture<T = unknown>(name: string): T {
  for (const p of [join(ROOT, name), join(ROOT, 'spec', name)]) {
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    } catch {
      // try next
    }
  }
  throw new Error(`fixture not found: ${name}`);
}
