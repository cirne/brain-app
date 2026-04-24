/**
 * Enron v1 eval CLI: load `.env` from cwd (same as `npm run dev` / server entry), then optional `--provider` / `--model`.
 * Run from repo root: `npm run eval:run:enron -- --model …` (args after `--`).
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

loadEvalEnvAndLlmCli(`Usage: npm run eval:run:enron -- [options]

Loads ./.env from the current working directory (same as the dev server).

Options:
  --provider, -p   LLM_PROVIDER (e.g. anthropic, openai, xai)
  --model, -m       LLM_MODEL (provider-specific id)
  -h, --help        Show this message

Env still applies (CLI overrides LLM_PROVIDER / LLM_MODEL only).
Example: npm run eval:run:enron -- --provider xai --model grok-4-1-fast
`)

const { runEnronV1Main } = await import('./runEnronV1.js')

void runEnronV1Main().catch(e => {
  console.error(e)
  process.exit(1)
})
