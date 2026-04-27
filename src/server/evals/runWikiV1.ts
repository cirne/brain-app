/**
 * Wiki buildout + cleanup (lint) eval: load eval/tasks/wiki-v1.jsonl, parallel runs, JSON report.
 * CLI: `npx tsx src/server/evals/wikiV1cli.ts`
 * Env: EVAL_WIKI_TASKS or EVAL_TASKS (path), EVAL_MAX_CONCURRENCY, BRAIN_HOME
 */
import { join, resolve } from 'node:path'
import { runLlmJsonlEvalMain } from './harness/runLlmJsonlEval.js'
import { loadWikiV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runWikiAgentEvalCase } from './harness/runWikiAgentEvalCase.js'
import type { WikiV1Task } from './harness/types.js'

function resolveWikiTaskFilePath(root: string): string {
  const w = process.env.EVAL_WIKI_TASKS?.trim()
  const t = process.env.EVAL_TASKS?.trim()
  if (w) {
    return resolve(w)
  }
  if (t) {
    return resolve(t)
  }
  return join(root, 'eval', 'tasks', 'wiki-v1.jsonl')
}

export async function runWikiV1Main(): Promise<number> {
  return runLlmJsonlEvalMain<WikiV1Task>({
    logPrefix: '[eval:wiki-v1]',
    outSlug: 'wiki-v1',
    resolveTaskFilePath: root => resolveWikiTaskFilePath(root),
    loadTasks: loadWikiV1TasksFromFile,
    runCase: runWikiAgentEvalCase,
    defaultMaxConcurrency: 2,
    formatCaseLogLine: r =>
      `${r.id}  ${Math.round(r.wallMs)}ms  tokens=${r.usage.totalTokens} cost~${r.usage.costTotal.toFixed(4)}  tools=${r.toolNames.join(',')}`,
    caseToReport: (c, task) => ({
      agent: task.agent,
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
