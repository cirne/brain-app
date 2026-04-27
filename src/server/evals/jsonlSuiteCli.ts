/**
 * Run all JSONL LLM eval suites in one process: Enron v1, then Wiki v1.
 * Invoked by `npm run eval:run` (after Vitest harness); or directly via tsx for debugging.
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runEnronV1Main } from './runEnronV1.js'
import { runWikiV1Main } from './runWikiV1.js'

loadEvalEnvAndLlmCli(`Usage: npm run eval:run -- [options]

(JSONL phase only; full eval:run also runs Vitest first — see eval/README.md.)

Loads ./.env from the repo root (same as the dev server), then runs every
JSONL agent eval in order:
  1. Enron v1 — assistant / mail tasks → data-eval/eval-runs/enron-v1-*.json
  2. Wiki v1 — buildout + cleanup → data-eval/eval-runs/wiki-v1-*.json

Both use BRAIN_HOME (default ./data-eval/brain via npm script) and the Enron
ripmail index from npm run eval:build.

Options:
  --provider, -p   LLM_PROVIDER (e.g. openai, anthropic)
  --model, -m      LLM_MODEL
  -h, --help

One JSONL suite only (advanced): npx tsx --tsconfig tsconfig.server.json src/server/evals/enronV1cli.ts
  or …/wikiV1cli.ts

Env: EVAL_MAX_CONCURRENCY, EVAL_TASKS, EVAL_WIKI_TASKS, etc. See eval/README.md.
`)

async function main(): Promise<void> {
  await runEnronV1Main()
  await runWikiV1Main()
}

void main().catch(e => {
  console.error(e)
  process.exit(1)
})
