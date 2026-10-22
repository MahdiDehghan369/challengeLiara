/* eslint-env node */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    es2023: true,
  },
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', '.siavash/', 'reports/', 'demo-apps/', 'specs/', 'tests/fixtures/'],
  rules: {
    // console output belongs to the UI layer only (AGENT_RULES §2)
    'no-console': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
  },
  overrides: [
    {
      files: ['src/ui/**/*.ts', 'scripts/**/*.ts'],
      rules: { 'no-console': 'off' },
    },
    {
      files: ['.eslintrc.cjs'],
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
  ],
};
