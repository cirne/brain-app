/**
 * Enron v1 eval runner: load JSONL tasks, run with bounded parallelism, write JSON report.
 * CLI: `BRAIN_HOME=./data-eval/brain npx tsx src/server/evals/enronV1cli.ts`
 * Env: EVAL_MAX_CONCURRENCY (default 12), EVAL_TASKS (path to jsonl, default eval/tasks/enron-v1.jsonl).
 * If **EVAL_ASSISTANT_NOW** is unset/empty, sets default **2002-01-01** for the run (see `resolveEvalAnchoredNow` + assistant session date).
 */
import { join, resolve } from 'node:path'
import { runAgentEvalCase } from './harness/runAgentEvalCase.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadEnronV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import type { EnronV1Task } from './harness/types.js'

export async function runEnronV1Main(): Promise<number> {
  /** Anchor “today” to the Enron corpus era so search_index / “recent” mail is not empty vs 2026 wall clock. */
  const prevEvalNow = process.env.EVAL_ASSISTANT_NOW
  const setDefaultEvalNow = !prevEvalNow?.trim()
  if (setDefaultEvalNow) process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
  try {
    return await runEnronV1MainInner()
  } finally {
    if (setDefaultEvalNow) delete process.env.EVAL_ASSISTANT_NOW
    else if (prevEvalNow !== undefined) process.env.EVAL_ASSISTANT_NOW = prevEvalNow
  }
}

async function runEnronV1MainInner(): Promise<number> {
  return runLlmJsonlEvalMain<EnronV1Task>({
    logPrefix: '[eval:enron-v1]',
    outSlug: 'enron-v1',
    resolveTaskFilePath: root =>
      process.env.EVAL_TASKS ? resolve(process.env.EVAL_TASKS) : join(root, 'eval', 'tasks', 'enron-v1.jsonl'),
    loadTasks: loadEnronV1TasksFromFile,
    runCase: runAgentEvalCase,
    defaultMaxConcurrency: 12,
    formatCaseLogLine: r =>
      `${r.id}  ${Math.round(r.wallMs)}ms  tokens=${r.usage.totalTokens} cost~${r.usage.costTotal.toFixed(4)}`,
    caseToReport: c => ({
      id: c.id,
      ok: c.ok,
      error: c.error,
      failReasons: c.failReasons,
      wallMs: Math.round(c.wallMs),
      usage: c.usage,
      completionCount: c.completionCount,
      toolNames: c.toolNames,
      model: c.model,
      provider: c.provider,
    }),
    ripIndexHint: 'Run: npm run eval:build',
  })
}
