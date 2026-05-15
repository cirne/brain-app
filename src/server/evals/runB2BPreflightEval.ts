import { join, resolve } from 'node:path'
import { DEFAULT_EVAL_JSONL_CONCURRENCY } from './harness/defaultEvalConcurrency.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadB2BPreflightTasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runB2BPreflightEvalCase } from './harness/runB2BPreflightEvalCase.js'
import type { B2BPreflightTask } from './harness/types.js'

export async function runB2BPreflightEvalMain(): Promise<number> {
  return runLlmJsonlEvalMain<B2BPreflightTask>({
    logPrefix: '[eval:b2b-preflight]',
    outSlug: 'b2b-preflight',
    resolveTaskFilePath: root =>
      process.env.EVAL_B2B_PREFLIGHT_TASKS
        ? resolve(process.env.EVAL_B2B_PREFLIGHT_TASKS)
        : join(root, 'eval', 'tasks', 'b2b-preflight.jsonl'),
    loadTasks: loadB2BPreflightTasksFromFile,
    runCase: runB2BPreflightEvalCase,
    defaultMaxConcurrency: DEFAULT_EVAL_JSONL_CONCURRENCY,
    formatCaseLogLine: r =>
      `${r.id}  ${Math.round(r.wallMs)}ms  tokens=${r.usage.totalTokens} cost~${r.usage.costTotal.toFixed(4)}`,
    caseToReport: (c, task) => ({
      id: c.id,
      ok: c.ok,
      error: c.error,
      failReasons: c.failReasons,
      wallMs: Math.round(c.wallMs),
      usage: c.usage,
      completionCount: c.completionCount,
      finalText: c.finalText,
      toolNames: c.toolNames,
      toolTextConcat: c.toolTextConcat,
      model: c.model,
      provider: c.provider,
      message: task.message,
      expectedExpectsResponse: task.expectsResponse,
    }),
    ripIndexHint: '(not required for this suite)',
    requireRipmailDb: false,
  })
}
