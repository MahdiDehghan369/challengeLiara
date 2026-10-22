import type { Config } from '../config/env.js';
import { loadModelsConfig, type ModelsConfig } from '../config/models.js';
import { OpenAiLlm, type OpenAiLlmOptions } from './client.js';
import { ToolProtocolLlm } from './json-protocol.js';
import { MockLlm, type MockRule } from './mock.js';
import { ModelRouter } from './router.js';
import type { LlmClient } from './types.js';

export * from './types.js';
export * from './router.js';
export * from './client.js';
export * from './mock.js';
export * from './json-protocol.js';

export interface CreateLlmOptions {
  models?: ModelsConfig;
  budget?: OpenAiLlmOptions['budget'];
  /** Mock mode: rules for the scripted LLM. */
  mockRules?: MockRule[];
}

/**
 * `LLM_MODE=mock` → `MockLlm` (no network); `live` → BoxAPI via `OpenAiLlm`, wrapped in
 * `ToolProtocolLlm` so json-protocol roles (OQ-26) accept `tools` like native ones.
 */
export function createLlm(config: Pick<Config, 'llm'>, opts: CreateLlmOptions = {}): LlmClient {
  if (config.llm.mode === 'mock') return new MockLlm(opts.mockRules ?? [], opts.budget ? { budget: opts.budget } : {});
  const router = new ModelRouter(opts.models ?? loadModelsConfig());
  const inner = new OpenAiLlm({ apiKey: config.llm.apiKey ?? '', router, ...(opts.budget ? { budget: opts.budget } : {}) });
  return new ToolProtocolLlm(inner, { protocolFor: (role) => router.pick(role).protocol });
}
