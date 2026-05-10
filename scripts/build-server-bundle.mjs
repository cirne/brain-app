#!/usr/bin/env node
/**
 * Production server build: bundle + minify app code into dist/server/*.js.
 * Dependencies stay external (node_modules); dev-only code (e.g. Vite middleware) is tree-shaken.
 * Copies repo `shared/` → `dist/server/shared/` (sibling of index.js; see resolveRepoSharedPath.ts),
 * `src/server/prompts/` → `dist/server/prompts/`, and `src/server/ripmail/rules/` → `dist/server/rules/`.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
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
  /** Match tsconfig.server.json `paths` (tsx / tsc) so bundled imports resolve. */
  alias: {
    '@server': resolve(root, 'src/server'),
    '@shared': resolve(root, 'src/shared'),
  },
}

await esbuild.build({
  ...common,
  entryPoints: [
    join(root, 'src/server/index.ts'),
    join(root, 'src/server/sync-cli.ts'),
    join(root, 'src/server/ripmail/rebuildFromMaildirCli.ts'),
  ],
  outdir,
})

const sharedSrc = join(root, 'shared')
if (existsSync(sharedSrc)) {
  cpSync(sharedSrc, join(outdir, 'shared'), { recursive: true })
}

const promptsSrc = join(root, 'src/server/prompts')
if (existsSync(promptsSrc)) {
  cpSync(promptsSrc, join(outdir, 'prompts'), { recursive: true })
}

/** inbox.ts loads `./rules/default_rules.v3.json` via import.meta.url → sibling of bundled index.js. */
const ripmailRulesSrc = join(root, 'src/server/ripmail/rules')
if (existsSync(ripmailRulesSrc)) {
  cpSync(ripmailRulesSrc, join(outdir, 'rules'), { recursive: true })
}

console.log('[build-server-bundle] done →', outdir)
