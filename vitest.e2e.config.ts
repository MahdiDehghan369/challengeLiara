import { defineConfig } from 'vitest/config';

// E2E tests hit real Liara; each suite must guard itself with RUN_E2E=1.
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
