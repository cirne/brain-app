import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_EVAL_JSONL_CONCURRENCY } from './harness/defaultEvalConcurrency.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadB2BV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runB2BEvalCase, b2bEvalTenantHomeForKey } from './harness/runB2BEvalCase.js'
import type { B2BV1Task } from './harness/types.js'

function assertDemoRipIndexes(): void {
  const missing: string[] = []
  for (const key of ['kean', 'lay'] as const) {
    const p = join(b2bEvalTenantHomeForKey(key), 'ripmail', 'ripmail.db')
    if (!existsSync(p)) missing.push(p)
  }
  if (missing.length) {
    console.error(
      `[eval:b2b-research] ripmail index missing for Kean and/or Lay demo tenants. Run: npm run brain:seed-enron-demo\n` +
        missing.map(m => `  expected: ${m}`).join('\n'),
    )
    process.exit(1)
  }
}

export async function runB2BResearchEvalMain(): Promise<number> {
  const prevEvalNow = process.env.EVAL_ASSISTANT_NOW
  const prevB2B = process.env.BRAIN_B2B_ENABLED
  const setDefaultEvalNow = !prevEvalNow?.trim()
  if (setDefaultEvalNow) process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
  process.env.BRAIN_B2B_ENABLED = 'true'
  try {
    assertDemoRipIndexes()
    return await runB2BResearchEvalMainInner()
  } finally {
    if (setDefaultEvalNow) delete process.env.EVAL_ASSISTANT_NOW
    else if (prevEvalNow !== undefined) process.env.EVAL_ASSISTANT_NOW = prevEvalNow
    if (prevB2B === undefined) delete process.env.BRAIN_B2B_ENABLED
    else process.env.BRAIN_B2B_ENABLED = prevB2B
  }
}

async function runB2BResearchEvalMainInner(): Promise<number> {
  return runLlmJsonlEvalMain<B2BV1Task>({
    logPrefix: '[eval:b2b-research]',
    outSlug: 'b2b-research-v1',
    resolveTaskFilePath: root =>
      process.env.EVAL_B2B_RESEARCH_TASKS
        ? resolve(process.env.EVAL_B2B_RESEARCH_TASKS)
        : join(root, 'eval', 'tasks', 'b2b-research-v1.jsonl'),
    loadTasks: loadB2BV1TasksFromFile,
    runCase: task => runB2BEvalCase(task, { skipFilter: true }),
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
      finalText: c.finalText,
      toolNames: c.toolNames,
      toolTextConcat: c.toolTextConcat,
      model: c.model,
      provider: c.provider,
      pipeline: 'research-draft-only',
    }),
    ripIndexHint: 'Run: npm run brain:seed-enron-demo',
    requireRipmailDb: false,
  })
}
