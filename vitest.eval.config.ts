import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = dirname(fileURLToPath(import.meta.url))

const resolveAlias = {
  '@client': join(root, 'src/client'),
  '@components': join(root, 'src/client/components'),
  '@server': join(root, 'src/server'),
  '@shared': join(root, 'src/shared'),
}

/** Eval Vitest slice (`src/server/evals` glob in `include`) — first phase of `npm run eval:run` (after `eval:build` when tests need the Enron index). */
export default defineConfig({
  resolve: { alias: resolveAlias },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/server/evals/**/*.test.ts'],
    setupFiles: [join(root, 'src/server/test/promptsSetup.ts')],
  },
})
