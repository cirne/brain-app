import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadB2BV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runB2BEvalCase, b2bEvalTenantHomeForKey } from './harness/runB2BEvalCase.js'
import type { B2BV1Task } from './harness/types.js'

export async function runB2BPoliciesMain(): Promise<number> {
  const prevEvalNow = process.env.EVAL_ASSISTANT_NOW
  const prevB2B = process.env.BRAIN_B2B_ENABLED
  const setDefaultEvalNow = !prevEvalNow?.trim()
  if (setDefaultEvalNow) process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
  process.env.BRAIN_B2B_ENABLED = 'true'
  try {
    const keanRip = join(b2bEvalTenantHomeForKey('kean'), 'ripmail', 'ripmail.db')
    if (!existsSync(keanRip)) {
      console.error(
        `[eval:b2b-policies] Kean ripmail index missing. Run: npm run brain:seed-enron-demo (expected ${keanRip})`,
      )
      process.exit(1)
    }
    return await runB2BPoliciesMainInner()
  } finally {
    if (setDefaultEvalNow) delete process.env.EVAL_ASSISTANT_NOW
    else if (prevEvalNow !== undefined) process.env.EVAL_ASSISTANT_NOW = prevEvalNow
    if (prevB2B === undefined) delete process.env.BRAIN_B2B_ENABLED
    else process.env.BRAIN_B2B_ENABLED = prevB2B
  }
}

async function runB2BPoliciesMainInner(): Promise<number> {
  return runLlmJsonlEvalMain<B2BV1Task>({
    logPrefix: '[eval:b2b-policies]',
    outSlug: 'b2b-policies',
    resolveTaskFilePath: root =>
      process.env.EVAL_B2B_POLICY_TASKS
        ? resolve(process.env.EVAL_B2B_POLICY_TASKS)
        : join(root, 'eval', 'tasks', 'b2b-policies.jsonl'),
    loadTasks: loadB2BV1TasksFromFile,
    runCase: runB2BEvalCase,
    defaultMaxConcurrency: 1,
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
