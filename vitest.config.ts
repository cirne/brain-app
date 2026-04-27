import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

const resolveAlias = {
  '@client': join(root, 'src/client'),
  '@components': join(root, 'src/client/components'),
  '@server': join(root, 'src/server'),
  '@shared': join(root, 'src/shared'),
}

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: resolveAlias,
    /** Prefer Svelte client runtime (not `index-server`) when bundling component tests. */
    conditions: ['browser', 'import', 'module', 'default'],
  },
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          /** jsdom only for Svelte components; keep `src/client/lib/*.test.ts` on Node. */
          include: ['src/client/components/**/*.test.ts'],
          environment: 'jsdom',
          setupFiles: [join(root, 'src/client/test/setup.ts')],
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          include: ['src/**/*.test.ts'],
          exclude: ['node_modules', 'src/server/evals/**', 'src/client/components/**/*.test.ts'],
          environment: 'node',
          setupFiles: [join(root, 'src/server/test/promptsSetup.ts')],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/server/**', 'src/shared/**', 'src/client/**'],
      exclude: ['src/server/evals/**', '**/*.html'],
    },
  },
})
