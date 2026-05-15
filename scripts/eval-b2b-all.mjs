#!/usr/bin/env node
/**
 * `npm run eval:b2b` — runs every B2B JSONL suite in **parallel** (separate processes).
 *
 * Each suite still uses its own internal case concurrency (`EVAL_MAX_CONCURRENCY`, suite defaults).
 * Do not pass `--id` here unless that id exists in **all** suite task files; use `npm run eval:b2b:<suite> -- --id …` instead.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(root, '..')
const dataRoot = process.env.BRAIN_DATA_ROOT ?? join(repoRoot, 'data')

/** Order is logical only; all start together via Promise.all. */
const suites = [
  { name: 'preflight', file: 'src/server/evals/b2bPreflightCli.ts' },
  { name: 'filter', file: 'src/server/evals/b2bFilterCli.ts' },
  { name: 'e2e', file: 'src/server/evals/b2bE2eCli.ts' },
  { name: 'research', file: 'src/server/evals/b2bResearchCli.ts' },
]

function runSuite(name, tsFile) {
  return new Promise(resolve => {
    const child = spawn(
      'npx',
      ['tsx', '--tsconfig', 'tsconfig.server.json', tsFile],
      {
        cwd: repoRoot,
        env: { ...process.env, BRAIN_DATA_ROOT: dataRoot },
        stdio: 'inherit',
      },
    )
    child.on('error', err => {
      console.error(`[eval:b2b] ${name}: spawn error`, err)
      resolve({ name, code: 1 })
    })
    child.on('close', code => resolve({ name, code: code ?? 1 }))
  })
}

const results = await Promise.all(suites.map(s => runSuite(s.name, s.file)))

console.log('\n[eval:b2b] summary (parallel workers)')
for (const r of results) {
  console.log(`  ${r.name}: ${r.code === 0 ? 'PASS' : 'FAIL'} (exit ${r.code})`)
}

const failed = results.filter(r => r.code !== 0)
process.exit(failed.length > 0 ? 1 : 0)
