import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runB2BV1Main } from './runB2BV1.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/b2bV1cli.ts [--id b2b-001-lay-priorities]

Runs B2B v1 JSONL evals (Kean asking Lay's brain by default).
Env: EVAL_B2B_TASKS, EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT.
`)

void runB2BV1Main()
  .then(() => {})
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
