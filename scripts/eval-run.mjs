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
const dataRoot = process.env.BRAIN_DATA_ROOT ?? join(repoRoot, 'data')
const nrEvalOptIn = process.env.BRAIN_EVAL_ENABLE_NEW_RELIC === '1'
const env = {
  ...process.env,
  BRAIN_DATA_ROOT: dataRoot,
  // Belt-and-suspenders: child processes can load `newrelic` before eval CLIs run `loadEvalEnvAndLlmCli`.
  ...(nrEvalOptIn ? {} : { NEW_RELIC_ENABLED: 'false' }),
}
const passThrough = process.argv.slice(2)
const helpOnly =
  passThrough.length === 1 && (passThrough[0] === '--help' || passThrough[0] === '-h')

/** Single JSONL case id: skip slow Vitest phase (same as `npm run eval:run -- --id …`). */
function hasEvalIdFlag(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id' && argv[i + 1]) return true
    if (argv[i]?.startsWith('--id=')) return true
  }
  return false
}

if (!helpOnly && !hasEvalIdFlag(passThrough)) {
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
