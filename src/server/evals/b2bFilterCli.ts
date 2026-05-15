import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runB2BFilterEvalMain } from './runB2BFilterEval.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/b2bFilterCli.ts [--id b2b-filter-travel-passthrough]

Runs B2B tunnel **privacy filter** JSONL evals only (draft answer + policy → one LLM call; same stack as filterB2BResponse).
No ripmail seed required. Uses BRAIN_LLM (standard tier), same as production filter agent.

Env: EVAL_B2B_FILTER_TASKS (override task file), EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT,
BRAIN_EVAL_JUDGE_LLM (when tasks use llmJudge).
`)

void runB2BFilterEvalMain()
  .then(() => {})
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
