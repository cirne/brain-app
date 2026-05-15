import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runB2BResearchEvalMain } from './runB2BResearchEval.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/b2bResearchCli.ts [--id b2b-research-001-lay-priorities]

Runs B2B **research-agent** JSONL evals only: tools + draft, **no** privacy-filter LLM.
Expectations apply to the research draft (same agent as full tunnel).

Requires Kean and Lay Enron demo ripmail indexes (\`npm run brain:seed-enron-demo\`).

Env: EVAL_B2B_RESEARCH_TASKS (override task file), EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT.
`)

void runB2BResearchEvalMain()
  .then(() => {})
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
