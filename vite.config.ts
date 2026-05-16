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
  /** Pre-bundle deps that are only loaded via dynamic import so dev never discovers them mid-session,
   *  re-optimizes `.vite/deps` (hash churn), and races requests against deleted chunk files. */
  optimizeDeps: {
    include: ['@tauri-apps/plugin-shell'],
  },
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
    /** Set `BRAIN_CLIENT_SOURCEMAP=1` when building to debug prod bundles in the browser (`pnpm run build:client:sourcemap`). */
    sourcemap: process.env.BRAIN_CLIENT_SOURCEMAP === '1',
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
    },
  },
})
