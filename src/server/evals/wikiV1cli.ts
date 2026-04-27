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
  --id             Run only this task id (sets EVAL_CASE_ID); exits 1 if not in the wiki file
  -h, --help

Full eval (Vitest + Enron + Wiki JSONL): npm run eval:run
`)

const { runWikiV1Main } = await import('./runWikiV1.js')

void runWikiV1Main()
  .then((n) => {
    if (process.env.EVAL_CASE_ID?.trim() && n === 0) {
      console.error(
        `[eval:wiki-v1] No task with id ${JSON.stringify(process.env.EVAL_CASE_ID.trim())} in the wiki JSONL file.`,
      )
      process.exit(1)
    }
  })
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
