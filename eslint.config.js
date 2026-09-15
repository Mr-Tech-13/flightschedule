import js from '@eslint/js';

const sharedGlobals = {
  console: 'readonly',
  process: 'readonly',
  Buffer: 'readonly',
  fetch: 'readonly',
  setTimeout: 'readonly',
  setInterval: 'readonly'
};

export default [
  {
    ignores: ['data/**', 'private/**', 'node_modules/**', 'coverage/**']
  },
  js.configs.recommended,
  {
    files: ['server/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: sharedGlobals
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...sharedGlobals,
        document: 'readonly',
        window: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
        matchMedia: 'readonly',
        MutationObserver: 'readonly',
        FormData: 'readonly',
        Date: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly'
      }
    }
  }
];
