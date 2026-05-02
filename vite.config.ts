import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

const repoRoot = dirname(fileURLToPath(import.meta.url))

/** Must match `BRAIN_DEFAULT_HTTP_PORT` / `npm run dev` server (see `src/server/lib/brainHttpPort.ts`). */
const apiPort = process.env.PORT ?? '3000'

export default defineConfig({
  root: 'src/client',
  resolve: {
    alias: {
      '@client': join(repoRoot, 'src/client'),
      '@components': join(repoRoot, 'src/client/components'),
      '@shared': join(repoRoot, 'src/shared'),
    },
  },
  plugins: [tailwindcss(), svelte()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
})
