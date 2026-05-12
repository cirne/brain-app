/**
 * Mail compose v1 JSONL only (draft_email–heavy tasks). Full pipeline: npm run eval:run
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/mailComposeV1cli.ts [options]

Loads ./.env (same as dev). Runs eval/tasks/mail-compose-v1.jsonl only (Steve Kean / default BRAIN_HOME).

Options:
  --provider, -p   Merged into BRAIN_LLM
  --model, -m      Merged into BRAIN_LLM
  --fastLlm        Sets BRAIN_FAST_LLM
  --id             Run only this task id (sets EVAL_CASE_ID)
  -h, --help

Env: EVAL_MAIL_COMPOSE_TASKS (override JSONL path), EVAL_ASSISTANT_NOW, EVAL_MAX_CONCURRENCY, EVAL_AGENT_TRACE, …
See eval/README.md
`)

const { runMailComposeV1Main } = await import('./runMailComposeV1.js')

void runMailComposeV1Main()
  .then((n) => {
    if (process.env.EVAL_CASE_ID?.trim() && n === 0) {
      console.error(
        `[eval:mail-compose-v1] No task with id ${JSON.stringify(process.env.EVAL_CASE_ID.trim())} in the mail-compose JSONL file.`,
      )
      process.exit(1)
    }
  })
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
