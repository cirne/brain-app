import { defineConfig } from 'vitest/config'

/** Assistant / wiki eval smoke tests; requires `npm run eval:build` first. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/server/evals/**/*.test.ts'],
  },
})
