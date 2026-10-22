import type { ModelRole, ModelsConfig } from '../config/models.js';

export interface RoutedModel {
  model: string;
  fallbacks: string[];
  /** `native-tools` → send `tools`; `json` → tools must go through the JSON protocol (T3.2, OQ-26). */
  protocol: 'native-tools' | 'json';
}

/** Picks models per role from `config/models.json` (T0.2). */
export class ModelRouter {
  constructor(private readonly config: ModelsConfig) {}

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  pick(role: ModelRole): RoutedModel {
    const r = this.config.roles[role];
    return { model: r.model, fallbacks: [...r.fallbacks], protocol: r.fallbackProtocol };
  }

  /** The primary model followed by its fallbacks, without duplicates. */
  candidates(role: ModelRole): string[] {
    const r = this.pick(role);
    return [r.model, ...r.fallbacks].filter((m, i, a) => a.indexOf(m) === i);
  }
}
