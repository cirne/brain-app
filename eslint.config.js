import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import sveltePlugin from 'eslint-plugin-svelte'
import svelteParser from 'svelte-eslint-parser'
import globals from 'globals'

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    files: ['src/server/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: './tsconfig.server.json' },
      globals: { ...globals.node },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
    },
  },
  {
    files: ['src/client/**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tsParser },
      globals: { ...globals.browser },
    },
    plugins: { svelte: sveltePlugin },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'svelte/no-at-html-tags': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/'],
  },
]
