import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_EVAL_JSONL_CONCURRENCY } from './harness/defaultEvalConcurrency.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadB2BV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runSlackIntegrationEvalCase, slackIntegrationEvalTenantHomeForKey } from './harness/runSlackIntegrationEval.js'
import type { B2BV1Task } from './harness/types.js'

function assertDemoRipIndexes(): void {
  const missing: string[] = []
  for (const key of ['kean', 'lay'] as const) {
    const p = join(slackIntegrationEvalTenantHomeForKey(key), 'ripmail', 'ripmail.db')
    if (!existsSync(p)) missing.push(p)
  }
  if (missing.length) {
    console.error(
      `[eval:slack-integration] ripmail index missing. Run: npm run brain:seed-enron-demo\n` +
        missing.map((m) => `  expected: ${m}`).join('\n'),
    )
    process.exit(1)
  }
}

export async function runSlackIntegrationEvalMainFn(): Promise<number> {
  const prevEvalNow = process.env.EVAL_ASSISTANT_NOW
  const setDefaultEvalNow = !prevEvalNow?.trim()
  if (setDefaultEvalNow) process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
  try {
    assertDemoRipIndexes()
    return await runLlmJsonlEvalMain<B2BV1Task>({
      logPrefix: '[eval:slack-integration]',
      outSlug: 'slack-integration-v1',
      resolveTaskFilePath: (root) =>
        process.env.EVAL_SLACK_INTEGRATION_TASKS
          ? resolve(process.env.EVAL_SLACK_INTEGRATION_TASKS)
          : join(root, 'eval', 'tasks', 'slack-integration-v1.jsonl'),
      loadTasks: loadB2BV1TasksFromFile,
      runCase: (task) => runSlackIntegrationEvalCase(task),
      defaultMaxConcurrency: DEFAULT_EVAL_JSONL_CONCURRENCY,
      formatCaseLogLine: (r) =>
        `${r.id}  ${Math.round(r.wallMs)}ms  tokens=${r.usage.totalTokens} cost~${r.usage.costTotal.toFixed(4)}`,
      caseToReport: (c) => ({
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
        pipeline: 'slack-integration-v1',
      }),
      ripIndexHint: 'Run: npm run brain:seed-enron-demo',
      requireRipmailDb: false,
    })
  } finally {
    if (setDefaultEvalNow) delete process.env.EVAL_ASSISTANT_NOW
    else if (prevEvalNow !== undefined) process.env.EVAL_ASSISTANT_NOW = prevEvalNow
  }
}
