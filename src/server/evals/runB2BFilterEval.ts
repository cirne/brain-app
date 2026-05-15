import { join, resolve } from 'node:path'
import { DEFAULT_EVAL_JSONL_CONCURRENCY } from './harness/defaultEvalConcurrency.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadB2BFilterEvalTasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runB2BFilterEvalCase } from './harness/runB2BFilterEvalCase.js'
import type { B2BFilterEvalTask } from './harness/types.js'

export async function runB2BFilterEvalMain(): Promise<number> {
  return runLlmJsonlEvalMain<B2BFilterEvalTask>({
    logPrefix: '[eval:b2b-filter]',
    outSlug: 'b2b-filter',
    resolveTaskFilePath: root =>
      process.env.EVAL_B2B_FILTER_TASKS
        ? resolve(process.env.EVAL_B2B_FILTER_TASKS)
        : join(root, 'eval', 'tasks', 'b2b-filter.jsonl'),
    loadTasks: loadB2BFilterEvalTasksFromFile,
    runCase: runB2BFilterEvalCase,
    defaultMaxConcurrency: DEFAULT_EVAL_JSONL_CONCURRENCY,
    filterTasksByEvalCaseId: (allTasks, onlyId) => {
      const exact = allTasks.filter(t => t.id === onlyId)
      if (exact.length > 0) return exact
      return allTasks.filter(t => t.caseGroupId === onlyId)
    },
    formatCaseLogLine: r =>
      `${r.id}  ${Math.round(r.wallMs)}ms  tokens=${r.usage.totalTokens} cost~${r.usage.costTotal.toFixed(4)}`,
    caseToReport: (c, task, _i) => ({
      id: c.id,
      caseGroupId: task.caseGroupId,
      policyId: task.policyId,
      ok: c.ok,
      error: c.error,
      failReasons: c.failReasons,
      wallMs: Math.round(c.wallMs),
      usage: c.usage,
      completionCount: c.completionCount,
      finalText: c.finalText,
      draftAnswer: task.draftAnswer,
      privacyPolicyPreview: task.privacyPolicy.slice(0, 240),
    }),
    ripIndexHint: '(not required for this suite)',
    requireRipmailDb: false,
  })
}
