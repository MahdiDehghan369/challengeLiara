import { defineConfig } from 'vitest/config';

// Unit + integration tests always run against mocks (AGENT_RULES §1.8).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    env: {
      LIARA_MODE: 'mock',
      LLM_MODE: 'mock',
      LOG_LEVEL: 'silent',
    },
  },
});
