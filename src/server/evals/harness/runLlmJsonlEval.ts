import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pLimit from 'p-limit'
import { addLlmUsage, isZeroUsage, type LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'
import {
  getEffectiveLlmModelForEval,
  getEffectiveLlmProviderForEval,
  sanitizeLlmModelIdForFilename,
} from './effectiveLlmEnv.js'
import { hasAnyLlmKey, parseEvalMaxConcurrency } from './llmPreflight.js'
import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'

const ZERO: LlmUsageSnapshot = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
}

/** harness/ -> evals/ -> server/ -> src/ -> repo root (used by Enron/wiki JSONL CLIs) */
export function getEvalRepoRoot(): string {
  return fileURLToPath(new URL('../../../..', import.meta.url))
}

export type LlmJsonlEvalConfig<TTask extends { id: string }> = {
  logPrefix: string
  /** Used in report filename: `${outSlug}-<model-segment>-<timestamp>.json` (model from effective `LLM_MODEL`) */
  outSlug: string
  resolveTaskFilePath: (root: string) => string
  loadTasks: (absPath: string) => Promise<TTask[]>
  runCase: (task: TTask) => Promise<RunAgentEvalCaseResult>
  defaultMaxConcurrency: number
  /** Per-case line after a run (stdout). */
  formatCaseLogLine: (r: RunAgentEvalCaseResult) => string
  caseToReport: (c: RunAgentEvalCaseResult, task: TTask, index: number) => Record<string, unknown>
  noLlmKeyMessage: string
  ripIndexHint: string
}

/**
 * @returns How many cases ran (0 when `EVAL_CASE_ID` filters to no match in this suite—skipped).
 */
export async function runLlmJsonlEvalMain<TTask extends { id: string }>(
  config: LlmJsonlEvalConfig<TTask>,
): Promise<number> {
  const {
    logPrefix,
    outSlug,
    resolveTaskFilePath,
    loadTasks,
    runCase,
    defaultMaxConcurrency,
    formatCaseLogLine,
    caseToReport,
    noLlmKeyMessage,
    ripIndexHint,
  } = config

  /** JSONL evals must not perform real `ripmail send` (set `EVAL_RIPMAIL_SEND_DRY_RUN=0` to allow). */
  if (process.env.EVAL_RIPMAIL_SEND_DRY_RUN === undefined) {
    process.env.EVAL_RIPMAIL_SEND_DRY_RUN = '1'
  }

  const root = getEvalRepoRoot()
  const defaultBrain = join(root, 'data-eval', 'brain')
  const brain = process.env.BRAIN_HOME ? resolve(process.env.BRAIN_HOME) : defaultBrain
  const rip = join(brain, 'ripmail', 'ripmail.db')
  process.env.BRAIN_HOME = brain

  const tasksPath = resolveTaskFilePath(root)

  if (!existsSync(tasksPath)) {
    console.error(`${logPrefix} Task file not found: ${tasksPath}`)
    process.exit(1)
  }
  if (!existsSync(rip)) {
    console.error(`${logPrefix} ripmail index missing. ${ripIndexHint} (expected ${rip})`)
    process.exit(1)
  }
  if (!hasAnyLlmKey()) {
    console.error(`${logPrefix} ${noLlmKeyMessage}`)
    process.exit(1)
  }

  const allTasks = await loadTasks(tasksPath)
  if (allTasks.length === 0) {
    console.error(`${logPrefix} No tasks in file.`)
    process.exit(1)
  }

  const onlyId = process.env.EVAL_CASE_ID?.trim()
  let tasks: TTask[] = allTasks
  if (onlyId) {
    tasks = allTasks.filter(t => t.id === onlyId)
    if (tasks.length === 0) {
      console.log(
        `${logPrefix} Skipping: no case with id ${JSON.stringify(onlyId)} in this suite (${allTasks.length} other case(s) in file).`,
      )
      return 0
    }
  }

  const maxConc = parseEvalMaxConcurrency(process.env.EVAL_MAX_CONCURRENCY, defaultMaxConcurrency, tasks.length)
  const limit = pLimit(maxConc)

  const startedAt = new Date().toISOString()
  console.log(`${logPrefix} ${tasksPath}  (${tasks.length} cases, concurrency ${maxConc})`)
  console.log(`${logPrefix} BRAIN_HOME=${brain}`)

  const tAll = performance.now()
  const caseResults: RunAgentEvalCaseResult[] = await Promise.all(
    tasks.map(t =>
      limit(async () => {
        const r = await runCase(t)
        const status = r.ok ? 'ok' : 'FAIL'
        console.log(`${logPrefix} ${status}  ${formatCaseLogLine(r)}`)
        return r
      }),
    ),
  )
  const wallTotalMs = performance.now() - tAll

  const pass = caseResults.filter(r => r.ok).length
  const fail = caseResults.length - pass
  let sumUsage: LlmUsageSnapshot = { ...ZERO }
  for (const c of caseResults) {
    if (!isZeroUsage(c.usage)) {
      sumUsage = addLlmUsage(sumUsage, c.usage)
    }
  }

  const outDir = join(root, 'data-eval', 'eval-runs')
  mkdirSync(outDir, { recursive: true })
  const effectiveModel = getEffectiveLlmModelForEval()
  const effectiveProvider = getEffectiveLlmProviderForEval()
  const modelSegment = sanitizeLlmModelIdForFilename(effectiveModel)
  const outFile = join(
    outDir,
    `${outSlug}-${modelSegment}-${startedAt.replace(/[:.]/g, '-')}.json`,
  )

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    brainHome: brain,
    taskFile: tasksPath,
    maxConcurrency: maxConc,
    /** Same defaults as the chat agent when env vars are unset. */
    effectiveLlm: {
      provider: effectiveProvider,
      model: effectiveModel,
    },
    env: {
      LLM_PROVIDER: process.env.LLM_PROVIDER ?? null,
      LLM_MODEL: process.env.LLM_MODEL ?? null,
    },
    reportFile: outFile,
    wallTotalMs: Math.round(wallTotalMs),
    summary: {
      pass,
      fail,
      totalCases: caseResults.length,
      totalTokens: sumUsage.totalTokens,
      totalCost: sumUsage.costTotal,
    },
    cases: caseResults.map((c, i) => caseToReport(c, tasks[i]!, i)),
  }

  await writeFile(outFile, JSON.stringify(report, null, 2), 'utf-8')
  console.log(
    `${logPrefix} done  pass ${pass} / ${caseResults.length}  totalTokens=${sumUsage.totalTokens}  cost~${sumUsage.costTotal.toFixed(4)}  ${Math.round(wallTotalMs)}ms wall`,
  )
  console.log(`${logPrefix} wrote ${outFile}`)
  return caseResults.length
}
