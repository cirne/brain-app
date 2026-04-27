#!/usr/bin/env node
/**
 * `npm run eval:run` — Vitest eval harness (`vitest.eval.config.ts`), then all JSONL LLM suites.
 * Args after `npm run eval:run --` are passed only to the JSONL CLI (`--provider`, `--model`, `--help`).
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(root, '..')
const brainHome = process.env.BRAIN_HOME ?? join(repoRoot, 'data-eval', 'brain')
const env = { ...process.env, BRAIN_HOME: brainHome }
const passThrough = process.argv.slice(2)
const helpOnly =
  passThrough.length === 1 && (passThrough[0] === '--help' || passThrough[0] === '-h')

if (!helpOnly) {
  const vitest = spawnSync(
    'npx',
    ['vitest', 'run', '--config', 'vitest.eval.config.ts'],
    { cwd: repoRoot, env, stdio: 'inherit' },
  )
  if (vitest.status !== 0) process.exit(vitest.status ?? 1)
}

const jsonl = spawnSync(
  'npx',
  [
    'tsx',
    '--tsconfig',
    'tsconfig.server.json',
    join('src', 'server', 'evals', 'jsonlSuiteCli.ts'),
    ...passThrough,
  ],
  { cwd: repoRoot, env, stdio: 'inherit' },
)
process.exit(jsonl.status ?? 1)
