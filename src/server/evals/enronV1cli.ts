/**
 * Enron v1 eval CLI: load `.env` from cwd (same as `npm run dev` / server entry), then optional `--provider` / `--model`.
 * Advanced: Enron JSONL only. Full eval: `npm run eval:run`.
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/enronV1cli.ts [options]

Loads ./.env from the current working directory (same as the dev server).

Options:
  --provider, -p   LLM_PROVIDER (e.g. anthropic, openai, xai)
  --model, -m       LLM_MODEL (provider-specific id)
  --id              Run only this task id (sets EVAL_CASE_ID); exits 1 if not in the Enron file
  -h, --help        Show this message

Env still applies (CLI overrides LLM_PROVIDER / LLM_MODEL only).
Example: npx tsx --tsconfig tsconfig.server.json src/server/evals/enronV1cli.ts --provider xai --model grok-4-1-fast

Full eval (Vitest + Enron + Wiki JSONL): npm run eval:run
`)

const { runEnronV1Main } = await import('./runEnronV1.js')

void runEnronV1Main()
  .then((n) => {
    if (process.env.EVAL_CASE_ID?.trim() && n === 0) {
      console.error(
        `[eval:enron-v1] No task with id ${JSON.stringify(process.env.EVAL_CASE_ID.trim())} in the Enron JSONL file.`,
      )
      process.exit(1)
    }
  })
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
