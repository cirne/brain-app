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

/** Deterministic ripmail checks against `./data/usr_enrondemo00000000001` after `npm run brain:seed-enron-demo`. */
export default defineConfig({
  resolve: { alias: resolveAlias },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/server/evals/e2e/**/*.test.ts'],
  },
})
