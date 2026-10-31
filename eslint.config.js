// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// CLAUDE.md, rule 1: the simulation must not depend on rendering, DOM or UI code.
const simRestrictedImports = {
  patterns: [
    { group: ['three', 'three/*'], message: 'sim/core must not import three.js (CLAUDE.md rule 1).' },
    { group: ['preact', 'preact/*'], message: 'sim/core must not import Preact (CLAUDE.md rule 1).' },
    {
      group: ['**/render', '**/render/*', '**/ui', '**/ui/*', '**/input', '**/input/*', '**/debug', '**/debug/*'],
      message: 'sim/core must not import render, ui, input or debug (CLAUDE.md rule 1).',
    },
  ],
};

// CLAUDE.md, rule 2: determinism. No ambient randomness, clocks or browser globals.
const determinismProperties = [
  { object: 'Math', property: 'random', message: 'Use the seeded RNG from src/core/rng.ts (CLAUDE.md rule 2).' },
  { object: 'Date', property: 'now', message: 'No wall clock in the simulation (CLAUDE.md rule 2).' },
  { object: 'performance', property: 'now', message: 'No wall clock in the simulation (CLAUDE.md rule 2).' },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/sim/**/*.ts', 'src/core/**/*.ts'],
    languageOptions: {
      // Only plain ECMAScript globals: no window, document, localStorage, performance...
      globals: { ...globals.es2022 },
    },
    rules: {
      'no-restricted-imports': ['error', simRestrictedImports],
      'no-restricted-properties': ['error', ...determinismProperties],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'No DOM in sim/core (CLAUDE.md rule 1).' },
        { name: 'document', message: 'No DOM in sim/core (CLAUDE.md rule 1).' },
        { name: 'localStorage', message: 'No browser storage in sim/core.' },
        { name: 'performance', message: 'No wall clock in sim/core (CLAUDE.md rule 2).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'for...in is banned in sim/core: iterate arrays instead (CLAUDE.md rule 2).',
        },
        { selector: "NewExpression[callee.name='Date']", message: 'No wall clock in sim/core (CLAUDE.md rule 2).' },
      ],
    },
  },
  prettier,
);
