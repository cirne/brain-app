/**
 * Wiki buildout + cleanup eval CLI — see eval/README.md
 */
import { loadEvalEnvAndLlmCli } from './parseEvalLlmCli.js'

loadEvalEnvAndLlmCli(`Usage: npx tsx --tsconfig tsconfig.server.json src/server/evals/wikiV1cli.ts [options]

Loads ./.env (same as dev server). Default tasks concatenate eval/tasks/wiki-v1.jsonl and eval/tasks/wiki-kean-v1.jsonl (one wiki-v1 report; use EVAL_WIKI_TASKS or EVAL_TASKS for a single-file override).

Each JSONL case runs in a subprocess with --brain-wiki-root under ./.data-eval/wiki-eval-cases/<task-id>/ (reset before the run; left on disk for inspection — Enron fixture wiki seeded with starter + me.md / assistant.md).

Options:
  --provider, -p       Shorthand: merged into BRAIN_LLM (with --model or registry default)
  --model, -m          Shorthand: merged into BRAIN_LLM
  --fastLlm            Optional: sets BRAIN_FAST_LLM for this process
  --id                 Run only this task id (sets EVAL_CASE_ID); exits 1 if not in the wiki file
  --brain-wiki-root    Parent of wiki/ (overrides BRAIN_WIKI_ROOT for this process). Worker (--id + EVAL_SUBPROCESS_REPORT_FILE) only; orchestrator sets per case.
  -h, --help

Full eval (Vitest + Enron + Wiki JSONL): npm run eval:run
`)

const { runWikiV1Main, runWikiV1SubprocessWorker } = await import('./runWikiV1.js')

if (process.env.EVAL_SUBPROCESS_REPORT_FILE?.trim()) {
  const code = await runWikiV1SubprocessWorker()
  process.exit(code)
}

void runWikiV1Main()
  .then((n) => {
    if (process.env.EVAL_CASE_ID?.trim() && n === 0) {
      console.error(
        `[eval:wiki-v1] No task with id ${JSON.stringify(process.env.EVAL_CASE_ID.trim())} in the wiki JSONL file.`,
      )
      process.exit(1)
    }
  })
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
