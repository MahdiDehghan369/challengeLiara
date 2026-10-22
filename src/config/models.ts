import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ValidationError } from '../shared/errors.js';
import { fa } from '../ui/cli/i18n/fa.js';

export const ModelRoleSchema = z.object({
  model: z.string().min(1),
  fallbackProtocol: z.enum(['native-tools', 'json']),
  /** Other models to try in order if `model` fails. */
  fallbacks: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
});

export const ModelsConfigSchema = z.object({
  baseUrl: z.string().url().default('https://ai.boxapi.ir/ai/v1'),
  roles: z.object({
    chat: ModelRoleSchema,
    reasoning: ModelRoleSchema,
    code: ModelRoleSchema,
    cheap: ModelRoleSchema,
  }),
});

export type ModelRole = keyof z.infer<typeof ModelsConfigSchema>['roles'];
export type ModelRoleConfig = z.infer<typeof ModelRoleSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

export const DEFAULT_MODELS_PATH = 'config/models.json';

export function parseModelsConfig(raw: unknown): ModelsConfig {
  const parsed = ModelsConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError('Invalid config/models.json', {
      messageFa: fa.config.invalidModels,
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  return parsed.data;
}

export function loadModelsConfig(path: string = DEFAULT_MODELS_PATH): ModelsConfig {
  let text: string;
  try {
    text = readFileSync(resolve(path), 'utf8');
  } catch (cause) {
    throw new ValidationError(`Models config not found: ${path}`, { messageFa: fa.config.modelsNotFound, cause });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ValidationError(`Models config is not valid JSON: ${path}`, {
      messageFa: fa.config.invalidModels,
      cause,
    });
  }
  return parseModelsConfig(json);
}
