import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runB2BPoliciesMain } from './runB2BPolicies.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/b2bPoliciesCli.ts [--id b2b-policy-trusted-kean-lay]

Runs B2B tunnel policy JSONL evals (Ken Lay asker → Steve Kean owner) with LLM-as-judge expectations.
Env: EVAL_B2B_POLICY_TASKS (override task file), EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT,
BRAIN_EVAL_JUDGE_LLM (judge model; default in harness: openai/gpt-5.4-nano).
`)

void runB2BPoliciesMain()
  .then(() => {})
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
