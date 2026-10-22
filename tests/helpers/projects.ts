import { join } from 'node:path';

/** Root of the sample projects used by analyzer tests. */
export const PROJECTS = join(import.meta.dirname, '..', 'fixtures', 'projects');

export const project = (name: string): string => join(PROJECTS, name);
