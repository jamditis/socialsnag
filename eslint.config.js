import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        // Browser globals
        document: 'readonly',
        window: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Promise: 'readonly',
        // Chrome extension globals
        chrome: 'readonly',
      },
    },
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-control-regex': 'off',
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    ignores: [
      'dist/',
      'node_modules/',
      'docs/',
      'src/platforms/linkedin.js',
      'src/platforms/tiktok.js',
      'src/platforms/youtube.js',
    ],
  },
];
