import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@client': join(root, 'src/client'),
      '@components': join(root, 'src/client/components'),
      '@server': join(root, 'src/server'),
      '@shared': join(root, 'src/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'src/server/evals/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/server/**', 'src/shared/**'],
    },
  },
})
