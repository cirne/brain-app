import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

/** Assistant / wiki eval smoke tests; requires `npm run eval:build` first. */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/server/evals/**/*.test.ts'],
    setupFiles: [join(root, 'src/server/test/promptsSetup.ts')],
  },
})
