import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runB2BE2eMain } from './runB2BE2e.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/b2bE2eCli.ts [--id b2b-e2e-001-lay-priorities]

B2B **end-to-end** JSONL eval (research agent with tools → \`filterB2BResponse\`). Small task set;
use \`eval:b2b:research\` and \`eval:b2b:filter\` for breadth.

npm: \`npm run eval:b2b:e2e\` (aliases: \`eval:b2b:v1\`, \`eval:b2b:policies\`).
Env: EVAL_B2B_E2E_TASKS (override JSONL), or legacy EVAL_B2B_TASKS / EVAL_B2B_POLICY_TASKS,
EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT, BRAIN_EVAL_JUDGE_LLM.
`)

void runB2BE2eMain()
  .then(() => {})
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
