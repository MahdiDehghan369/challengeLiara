import type { Config } from '../config/env.js';
import { loadModelsConfig, type ModelsConfig } from '../config/models.js';
import { OpenAiLlm, type OpenAiLlmOptions } from './client.js';
import { MockLlm, type MockRule } from './mock.js';
import { ModelRouter } from './router.js';
import type { LlmClient } from './types.js';

export * from './types.js';
export * from './router.js';
export * from './client.js';
export * from './mock.js';

export interface CreateLlmOptions {
  models?: ModelsConfig;
  budget?: OpenAiLlmOptions['budget'];
  /** Mock mode: rules for the scripted LLM. */
  mockRules?: MockRule[];
}

/** `LLM_MODE=mock` → `MockLlm` (no network); `live` → BoxAPI via `OpenAiLlm`. */
export function createLlm(config: Pick<Config, 'llm'>, opts: CreateLlmOptions = {}): LlmClient {
  if (config.llm.mode === 'mock') return new MockLlm(opts.mockRules ?? [], opts.budget ? { budget: opts.budget } : {});
  return new OpenAiLlm({
    apiKey: config.llm.apiKey ?? '',
    router: new ModelRouter(opts.models ?? loadModelsConfig()),
    ...(opts.budget ? { budget: opts.budget } : {}),
  });
}
