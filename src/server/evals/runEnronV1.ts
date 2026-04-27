/**
 * Enron v1 eval runner: load JSONL tasks, run with bounded parallelism, write JSON report.
 * CLI: `BRAIN_HOME=./data-eval/brain npx tsx src/server/evals/enronV1cli.ts`
 * Env: EVAL_MAX_CONCURRENCY (default 12), EVAL_TASKS (path to jsonl, default eval/tasks/enron-v1.jsonl)
 */
import { join, resolve } from 'node:path'
import { runAgentEvalCase } from './harness/runAgentEvalCase.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadEnronV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import type { EnronV1Task } from './harness/types.js'

export async function runEnronV1Main(): Promise<number> {
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
    noLlmKeyMessage:
      'No LLM API key in env. Set e.g. ANTHROPIC_API_KEY or OPENAI_API_KEY, or EVAL_FORCE_RUN=1 to bypass this check.',
    ripIndexHint: 'Run: npm run eval:build',
  })
}
