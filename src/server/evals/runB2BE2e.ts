import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_EVAL_JSONL_CONCURRENCY } from './harness/defaultEvalConcurrency.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadB2BV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runB2BEvalCase, b2bEvalTenantHomeForKey } from './harness/runB2BEvalCase.js'
import type { B2BV1Task } from './harness/types.js'

function assertKeanAndLayRipmail(): void {
  for (const key of ['lay', 'kean'] as const) {
    const rip = join(b2bEvalTenantHomeForKey(key), 'ripmail', 'ripmail.db')
    if (!existsSync(rip)) {
      console.error(
        `[eval:b2b:e2e] ${key} ripmail index missing. Run: npm run brain:seed-enron-demo (expected ${rip})`,
      )
      process.exit(1)
    }
  }
}

export async function runB2BE2eMain(): Promise<number> {
  const prevEvalNow = process.env.EVAL_ASSISTANT_NOW
  const setDefaultEvalNow = !prevEvalNow?.trim()
  if (setDefaultEvalNow) process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
  try {
    assertKeanAndLayRipmail()
    return await runB2BE2eMainInner()
  } finally {
    if (setDefaultEvalNow) delete process.env.EVAL_ASSISTANT_NOW
    else if (prevEvalNow !== undefined) process.env.EVAL_ASSISTANT_NOW = prevEvalNow
  }
}

async function runB2BE2eMainInner(): Promise<number> {
  return runLlmJsonlEvalMain<B2BV1Task>({
    logPrefix: '[eval:b2b:e2e]',
    outSlug: 'b2b-e2e',
    resolveTaskFilePath: root => {
      const override =
        process.env.EVAL_B2B_E2E_TASKS?.trim() ||
        process.env.EVAL_B2B_TASKS?.trim() ||
        process.env.EVAL_B2B_POLICY_TASKS?.trim()
      return override ? resolve(override) : join(root, 'eval', 'tasks', 'b2b-e2e.jsonl')
    },
    loadTasks: loadB2BV1TasksFromFile,
    runCase: runB2BEvalCase,
    defaultMaxConcurrency: DEFAULT_EVAL_JSONL_CONCURRENCY,
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
      finalText: c.finalText,
      toolTextConcat: c.toolTextConcat,
      model: c.model,
      provider: c.provider,
    }),
    ripIndexHint: 'Run: npm run brain:seed-enron-demo',
  })
}
