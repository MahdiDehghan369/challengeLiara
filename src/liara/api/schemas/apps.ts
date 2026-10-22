import { z } from 'zod';

/** One entry of `GET /v1/projects` → `projects[]` (specs/paas.yaml #/components/schemas/Projects). */
export const ProjectRawSchema = z
  .object({
    _id: z.string(),
    project_id: z.string(),
    type: z.string(),
    // TODO(OQ-7): possible status values are not documented; kept as an opaque string.
    status: z.string().optional(),
    scale: z.coerce.number().optional(),
    planID: z.string().optional(),
    created_at: z.string().optional(),
    isDeployed: z.boolean().optional(),
  })
  .passthrough();

export const ProjectsResponseSchema = z.object({
  projects: z.array(ProjectRawSchema),
});

export type ProjectRaw = z.infer<typeof ProjectRawSchema>;

/** Normalized app. `id` = `_id` (for `{id}` endpoints), `name` = `project_id` (for `{name}` endpoints). */
export interface App {
  id: string;
  name: string;
  platform: string;
  status: string | undefined;
  scale: number | undefined;
  planID: string | undefined;
  createdAt: string | undefined;
  isDeployed: boolean | undefined;
  raw: ProjectRaw;
}

export function toApp(p: ProjectRaw): App {
  return {
    id: p._id,
    name: p.project_id,
    platform: p.type,
    status: p.status,
    scale: p.scale,
    planID: p.planID,
    createdAt: p.created_at,
    isDeployed: p.isDeployed,
    raw: p,
  };
}

export interface CreateAppInput {
  name: string;
  planID: string;
  platform: string;
  readOnlyRootFilesystem?: boolean;
  network?: string;
}

export const CreateAppInputSchema = z.object({
  name: z.string().min(1),
  planID: z.string().min(1),
  platform: z.string().min(1),
  readOnlyRootFilesystem: z.boolean().optional(),
  network: z.string().optional(),
});

/** Async/"accepted" replies: empty body (normalized by LiaraHttp to `{accepted:true}`) or any JSON object, e.g. `{message}`. */
export const AcceptedSchema = z.object({}).passthrough();
