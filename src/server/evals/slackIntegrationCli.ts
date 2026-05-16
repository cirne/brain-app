import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'
import { runSlackIntegrationEvalMainFn } from './runSlackIntegrationEvalMain.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/slackIntegrationCli.ts [--id slack-001-dm-resolve-target]

Runs Slack integration agent JSONL evals: integrationAgent draft → filterCorpusReply.
Uses Enron demo fixture tenants as owner/asker.

Requires Kean and Lay Enron demo ripmail indexes (npm run brain:seed-enron-demo).

Env: EVAL_SLACK_INTEGRATION_TASKS (override task file), EVAL_CASE_ID, EVAL_MAX_CONCURRENCY, BRAIN_DATA_ROOT.
`)

void runSlackIntegrationEvalMainFn()
  .then(() => {})
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
