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
      // T1.17: everything outside src/liara goes through the LiaraClient facade / liara/index.js barrel
      files: ['src/**/*.ts'],
      excludedFiles: ['src/liara/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/liara/api/*', '**/liara/api/**', '**/liara/mock/*', '**/liara/mock/**'],
                message: 'Use the LiaraClient facade or import types from liara/index.js (T1.17).',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['.eslintrc.cjs'],
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
  ],
};
