import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * `<project>/.siavash/project.json` (T3.5): remembers which Liara app a project deploys to, so a new
 * session (or a restart) recognises it without asking again.
 */
export const ProjectStateSchema = z.object({
  app: z.string().min(1).optional(),
  platform: z.string().optional(),
  port: z.number().int().positive().optional(),
  planID: z.string().optional(),
  deployMode: z.enum(['cli', 'api']).optional(),
  lastDeploymentId: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ProjectState = z.infer<typeof ProjectStateSchema>;

export function projectStatePath(projectPath: string): string {
  return join(projectPath, '.siavash', 'project.json');
}

/** Reads the project state; missing or invalid file → `undefined` (never throws). */
export function readProjectState(projectPath: string): ProjectState | undefined {
  const p = projectStatePath(projectPath);
  if (!existsSync(p)) return undefined;
  try {
    const parsed = ProjectStateSchema.safeParse(JSON.parse(readFileSync(p, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Merges `patch` into the stored state and writes it atomically. */
export function writeProjectState(projectPath: string, patch: ProjectState, now: () => Date = () => new Date()): ProjectState {
  const next = ProjectStateSchema.parse({ ...(readProjectState(projectPath) ?? {}), ...patch, updatedAt: now().toISOString() });
  const p = projectStatePath(projectPath);
  mkdirSync(join(projectPath, '.siavash'), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(tmp, p);
  return next;
}
