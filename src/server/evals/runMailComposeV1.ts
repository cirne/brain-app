/**
 * Mail compose v1: single-turn tasks that exercise draft_email (reply) against Kean fixture mail.
 * Env: EVAL_MAIL_COMPOSE_TASKS (override JSONL path), EVAL_ASSISTANT_NOW (defaults 2002-01-01), EVAL_CASE_ID / --id.
 */
import { join, resolve } from 'node:path'
import { runAgentEvalCase } from './harness/runAgentEvalCase.js'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadEnronV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import type { EnronV1Task } from './harness/types.js'

export async function runMailComposeV1Main(): Promise<number> {
  const prevEvalNow = process.env.EVAL_ASSISTANT_NOW
  const setDefaultEvalNow = !prevEvalNow?.trim()
  if (setDefaultEvalNow) process.env.EVAL_ASSISTANT_NOW = '2002-01-01'
  try {
    return await runMailComposeV1MainInner()
  } finally {
    if (setDefaultEvalNow) delete process.env.EVAL_ASSISTANT_NOW
    else if (prevEvalNow !== undefined) process.env.EVAL_ASSISTANT_NOW = prevEvalNow
  }
}

async function runMailComposeV1MainInner(): Promise<number> {
  return runLlmJsonlEvalMain<EnronV1Task>({
    logPrefix: '[eval:mail-compose-v1]',
    outSlug: 'mail-compose-v1',
    resolveTaskFilePath: root =>
      process.env.EVAL_MAIL_COMPOSE_TASKS?.trim()
        ? resolve(process.env.EVAL_MAIL_COMPOSE_TASKS.trim())
        : join(root, 'eval', 'tasks', 'mail-compose-v1.jsonl'),
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
      finalText: c.finalText,
      toolTextConcat: c.toolTextConcat,
      model: c.model,
      provider: c.provider,
    }),
    ripIndexHint: 'Run: npm run brain:seed-enron-demo',
  })
}
