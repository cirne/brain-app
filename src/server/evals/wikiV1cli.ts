/**
 * Wiki buildout + cleanup eval CLI — see eval/README.md
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/wikiV1cli.ts [options]

Loads ./.env (same as dev server). Default task file: eval/tasks/wiki-v1.jsonl
(override with EVAL_WIKI_TASKS, or EVAL_TASKS as fallback).

Options:
  --provider, -p   LLM_PROVIDER
  --model, -m      LLM_MODEL
  -h, --help

Full eval (Vitest + Enron + Wiki JSONL): npm run eval:run
`)

const { runWikiV1Main } = await import('./runWikiV1.js')

void runWikiV1Main().catch(e => {
  console.error(e)
  process.exit(1)
})
