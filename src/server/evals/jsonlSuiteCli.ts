/**
 * Run all JSONL LLM eval suites in one process: Enron v1, Mail compose v1, then Wiki v1.
 * Invoked by `npm run eval:run` (after Vitest harness); or directly via tsx for debugging.
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

loadEvalEnvAndLlmCli(`Usage: npm run eval:run -- [options]

(JSONL phase only; full eval:run also runs Vitest first — see eval/README.md —
unless you pass --id, in which case Vitest is skipped for a fast single-case run.)

Loads ./.env from the repo root (same as the dev server), then runs every
JSONL agent eval in order (each suite skips itself when --id is set and that
id is not in its task file). Note: .env overwrites matching keys in the
process environment; use --provider / --model to set BRAIN_LLM for this run.
  1. Enron v1 — assistant / mail tasks → data-eval/eval-runs/enron-v1-*.json
  2. Mail compose v1 — draft_email reply/new (Kean default) → data-eval/eval-runs/mail-compose-v1-*.json
  3. B2B E2E — slim research + filter tunnel → data-eval/eval-runs/b2b-e2e-*.json
  4. Wiki v1 — buildout + cleanup (wiki-v1.jsonl ⊕ wiki-kean-v1.jsonl by default; override with EVAL_WIKI_TASKS) → data-eval/eval-runs/wiki-v1-*.json

Both use BRAIN_HOME (default: Kean demo tenant usr_enrondemo00000000001 under BRAIN_DATA_ROOT; eval:run sets BRAIN_DATA_ROOT=./data) and the Enron
ripmail index from npm run brain:seed-enron-demo.

Options:
  --provider, -p   Merged into BRAIN_LLM (with --model or registry default)
  --model, -m      Merged into BRAIN_LLM
  --fastLlm        Optional: sets BRAIN_FAST_LLM
  --brain-wiki-root   Parent of wiki/ (sets BRAIN_WIKI_ROOT for this process, resolved absolute; ignored by Enron-only phases)
  --id            Run only the task with this id (e.g. enron-022-suggest-reply-chips or compose-001-reply-shapiro-my-thoughts);
                  also sets EVAL_CASE_ID. Exits 1 if the id is missing from all JSONL suites.
  -h, --help

One JSONL suite only (advanced): npx tsx --tsconfig tsconfig.server.json src/server/evals/enronV1cli.ts
  or …/mailComposeV1cli.ts / …/wikiV1cli.ts (pass --id the same way)

Env: EVAL_MAX_CONCURRENCY, EVAL_CASE_ID, EVAL_TASKS, EVAL_MAIL_COMPOSE_TASKS, EVAL_WIKI_TASKS, etc. See eval/README.md.
`)

async function main(): Promise<void> {
  const [{ runEnronV1Main }, { runMailComposeV1Main }, { runB2BE2eMain }, { runWikiV1Main }] = await Promise.all([
    import('./runEnronV1.js'),
    import('./runMailComposeV1.js'),
    import('./runB2BE2e.js'),
    import('./runWikiV1.js'),
  ])
  const nEnron = await runEnronV1Main()
  const nCompose = await runMailComposeV1Main()
  const nB2B = await runB2BE2eMain()
  const nWiki = await runWikiV1Main()
  const onlyId = process.env.EVAL_CASE_ID?.trim()
  if (onlyId && nEnron + nCompose + nB2B + nWiki === 0) {
    console.error(
      `[eval:jsonl] No task with id ${JSON.stringify(onlyId)} in Enron, mail-compose, B2B, or wiki JSONL task files (check eval/tasks/enron-v1.jsonl, mail-compose-v1.jsonl, b2b-e2e.jsonl, wiki-v1.jsonl ⊕ wiki-kean-v1.jsonl default bundle, or EVAL_*_TASKS overrides).`,
    )
    process.exit(1)
  }
}

void main().catch(e => {
  console.error(e)
  process.exit(1)
})
