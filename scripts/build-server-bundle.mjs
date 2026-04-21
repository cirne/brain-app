#!/usr/bin/env node
/**
 * Production server build: bundle + minify app code into dist/server/*.js.
 * Dependencies stay external (node_modules); dev-only code (e.g. Vite middleware) is tree-shaken.
 * Copies repo `shared/` → `dist/server/shared/` (sibling of index.js; see resolveRepoSharedPath.ts).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outdir = join(root, 'dist/server')

if (existsSync(outdir)) {
  rmSync(outdir, { recursive: true })
}
mkdirSync(outdir, { recursive: true })

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
}

await esbuild.build({
  ...common,
  entryPoints: [join(root, 'src/server/index.ts'), join(root, 'src/server/sync-cli.ts')],
  outdir,
})

const sharedSrc = join(root, 'shared')
if (existsSync(sharedSrc)) {
  cpSync(sharedSrc, join(outdir, 'shared'), { recursive: true })
}

console.log('[build-server-bundle] done →', outdir)
