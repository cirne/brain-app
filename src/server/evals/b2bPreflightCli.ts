import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runB2BPreflightEvalMain } from './runB2BPreflightEval.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/b2bPreflightCli.ts [--id b2b-preflight-ask-q1]

Runs B2B tunnel preflight JSONL evals (one LLM call classifies whether a peer message expects a drafted reply).
Env: EVAL_B2B_PREFLIGHT_TASKS (override task file), EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT,
optional BRAIN_FAST_LLM (cheaper tier when set; when unset preflight uses BRAIN_LLM / standard tier).
`)

void runB2BPreflightEvalMain()
  .then(() => {})
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
