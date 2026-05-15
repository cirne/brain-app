import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pLimit from 'p-limit'
import { addLlmUsage, isZeroUsage, type LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import {
  getEffectiveLlmModelForEval,
  getEffectiveLlmProviderForEval,
  sanitizeLlmModelIdForFilename,
} from './effectiveLlmEnv.js'
import { logJsonlEvalCaseFailure } from './logJsonlEvalCaseFailure.js'
import { parseEvalMaxConcurrency } from './llmPreflight.js'
import type { RunAgentEvalCaseResult } from './runAgentEvalCase.js'
import { resolveEvalBrainHome } from '../evalDefaultBrainHome.js'

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
  /** Used in report filename: `${outSlug}-<model-segment>-<timestamp>.json` (model from effective `BRAIN_LLM`) */
  outSlug: string
  /**
   * Default: load a single file from {@link resolveTaskFilePath}.
   * When provided, each path is loaded in order and concatenated (e.g. wiki v1 + persona subset). Task ids must be unique.
   */
  resolveTaskBundlePaths?: (root: string) => string[]
  resolveTaskFilePath: (root: string) => string
  loadTasks: (absPath: string) => Promise<TTask[]>
  runCase: (task: TTask) => Promise<RunAgentEvalCaseResult>
  defaultMaxConcurrency: number
  /** Per-case line after a run (stdout). */
  formatCaseLogLine: (r: RunAgentEvalCaseResult) => string
  caseToReport: (c: RunAgentEvalCaseResult, task: TTask, index: number) => Record<string, unknown>
  ripIndexHint: string
  /** When false, do not require `ripmail/ripmail.db` under eval BRAIN_HOME (e.g. preflight-only suites). */
  requireRipmailDb?: boolean
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
    resolveTaskBundlePaths,
    resolveTaskFilePath,
    loadTasks,
    runCase,
    defaultMaxConcurrency,
    formatCaseLogLine,
    caseToReport,
    ripIndexHint,
    requireRipmailDb = true,
  } = config

  /** JSONL evals must not perform real `ripmail send` (set `EVAL_RIPMAIL_SEND_DRY_RUN=0` to allow). */
  if (process.env.EVAL_RIPMAIL_SEND_DRY_RUN === undefined) {
    process.env.EVAL_RIPMAIL_SEND_DRY_RUN = '1'
  }

  const root = getEvalRepoRoot()
  const brain = resolveEvalBrainHome(root)
  const rip = join(brain, 'ripmail', 'ripmail.db')
  process.env.BRAIN_HOME = brain

  const bundlePaths =
    typeof resolveTaskBundlePaths === 'function' ? resolveTaskBundlePaths(root) : [resolveTaskFilePath(root)]
  let tasksReportLabel = bundlePaths[0]
  if (bundlePaths.length > 1) {
    tasksReportLabel = `${bundlePaths.length} bundles: ${bundlePaths.map(p => p.replace(root + '/', '')).join(' + ')}`
  }

  for (const tasksPath of bundlePaths) {
    if (!existsSync(tasksPath)) {
      console.error(`${logPrefix} Task file not found: ${tasksPath}`)
      process.exit(1)
    }
  }
  if (requireRipmailDb && !existsSync(rip)) {
    console.error(`${logPrefix} ripmail index missing. ${ripIndexHint} (expected ${rip})`)
    process.exit(1)
  }

  const allTasks: TTask[] = []
  const seenIds = new Set<string>()
  for (const tasksPath of bundlePaths) {
    const batch = await loadTasks(tasksPath)
    for (const t of batch) {
      if (seenIds.has(t.id)) {
        console.error(`${logPrefix} Duplicate task id across bundles: ${JSON.stringify(t.id)}`)
        process.exit(1)
      }
      seenIds.add(t.id)
      allTasks.push(t)
    }
  }
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
  console.log(`${logPrefix} ${tasksReportLabel}  (${tasks.length} cases, concurrency ${maxConc})`)
  console.log(`${logPrefix} BRAIN_HOME=${brain}`)

  const tAll = performance.now()
  const caseResults: RunAgentEvalCaseResult[] = await Promise.all(
    tasks.map(t =>
      limit(async () => {
        const r = await runWithTenantContextAsync(
          { tenantUserId: '_single', workspaceHandle: '_single', homeDir: brain },
          async () => runCase(t),
        )
        const status = r.ok ? 'ok' : 'FAIL'
        console.log(`${logPrefix} ${status}  ${formatCaseLogLine(r)}`)
        if (!r.ok) logJsonlEvalCaseFailure(logPrefix, r)
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
    taskFile: bundlePaths.length === 1 ? bundlePaths[0] : bundlePaths,
    maxConcurrency: maxConc,
    /** Same defaults as the chat agent when env vars are unset. */
    effectiveLlm: {
      provider: effectiveProvider,
      model: effectiveModel,
    },
    env: {
      BRAIN_LLM: process.env.BRAIN_LLM ?? null,
      BRAIN_FAST_LLM: process.env.BRAIN_FAST_LLM ?? null,
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
  if (fail > 0) {
    process.exitCode = 1
  }
  return caseResults.length
}
