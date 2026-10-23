import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Incidents the MCP side knows about (T9.8): handed-off code fixes (from the fix router's `onBrief`)
 * plus any Fix Brief already on disk under `<project>/.siavash/fix-briefs/`. In memory per server
 * process; the brief files are the durable part.
 */

export type BookStatus = 'waiting-fix' | 'fix-reported' | 'resolved';

export interface BookEntry {
  id: string;
  app?: string;
  titleFa?: string;
  status: BookStatus;
  briefPath?: string;
  commit?: string;
  updatedAt: string;
}

export class IncidentBook {
  private readonly entries = new Map<string, BookEntry>();

  constructor(
    private readonly projectRoot?: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  upsert(e: Omit<BookEntry, 'updatedAt'>): BookEntry {
    const next = { ...this.entries.get(e.id), ...e, updatedAt: this.now().toISOString() };
    this.entries.set(e.id, next);
    return next;
  }

  /** Book entry, or one made from a brief file on disk. */
  get(id: string): BookEntry | undefined {
    const known = this.entries.get(id);
    if (known) return known;
    const path = this.briefPath(id);
    return path ? this.upsert({ id, status: 'waiting-fix', briefPath: path }) : undefined;
  }

  brief(id: string): string | undefined {
    const e = this.get(id);
    return e?.briefPath && existsSync(e.briefPath) ? readFileSync(e.briefPath, 'utf8') : undefined;
  }

  listOpen(): BookEntry[] {
    for (const id of this.briefIdsOnDisk()) this.get(id);
    return [...this.entries.values()].filter((e) => e.status !== 'resolved').sort((a, b) => a.id.localeCompare(b.id));
  }

  private briefDir(): string | undefined {
    return this.projectRoot ? join(this.projectRoot, '.siavash', 'fix-briefs') : undefined;
  }

  private briefPath(id: string): string | undefined {
    const dir = this.briefDir();
    if (!dir || !/^[\w.-]+$/.test(id)) return undefined;
    const p = join(dir, `${id}.md`);
    return existsSync(p) ? p : undefined;
  }

  private briefIdsOnDisk(): string[] {
    const dir = this.briefDir();
    if (!dir || !existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.slice(0, -3));
  }
}
