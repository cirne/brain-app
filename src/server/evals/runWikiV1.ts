/**
 * Wiki execute (buildout/execute alias), survey, and cleanup (lint) eval: load JSONL tasks, one subprocess per case (isolated
 * `BRAIN_WIKI_ROOT` under `.data-eval/wiki-eval-cases/<task-id>/`, persisted for inspection), JSON report.
 * CLI: `npx tsx src/server/evals/wikiV1cli.ts`
 * Env: EVAL_WIKI_TASKS or EVAL_TASKS (path), EVAL_MAX_CONCURRENCY, BRAIN_HOME, EVAL_SUBPROCESS_REPORT_FILE (worker only)
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePromptsRoot } from '@server/lib/prompts/registry.js'
import { runWithTenantContextAsync } from '@server/lib/tenant/tenantContext.js'
import { DEFAULT_EVAL_JSONL_CONCURRENCY } from './harness/defaultEvalConcurrency.js'
import { runLlmJsonlEvalMain, getEvalRepoRoot } from './harness/runLlmJsonlEval.js'
import { resolveEvalBrainHome } from './evalDefaultBrainHome.js'
import { loadWikiV1TasksFromFile } from './harness/loadJsonlEvalTasks.js'
import { runWikiAgentEvalCase } from './harness/runWikiAgentEvalCase.js'
import { seedEnronEvalWiki } from './harness/seedEnronEvalWiki.js'
import type { RunAgentEvalCaseResult } from './harness/runAgentEvalCase.js'
import type { WikiV1Task } from './harness/types.js'
import { wikiEvalCaseBrainWikiParent } from './wikiEvalCasePaths.js'

ensurePromptsRoot(fileURLToPath(new URL('../prompts', import.meta.url)))

export function resolveWikiTaskFilePath(root: string): string {
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

/** Default pipeline loads `wiki-v1.jsonl` then `wiki-kean-v1.jsonl` (Steve Kean / kean-s subset). */
export function resolveWikiEvalBundlePaths(root: string): string[] {
  const w = process.env.EVAL_WIKI_TASKS?.trim()
  const t = process.env.EVAL_TASKS?.trim()
  if (w) {
    return [resolve(w)]
  }
  if (t) {
    return [resolve(t)]
  }
  return [join(root, 'eval', 'tasks', 'wiki-v1.jsonl'), join(root, 'eval', 'tasks', 'wiki-kean-v1.jsonl')]
}

function zeroUsage(): RunAgentEvalCaseResult['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
  }
}

function subprocessFail(
  task: WikiV1Task,
  msg: string,
  wallMs: number = 0,
): RunAgentEvalCaseResult {
  return {
    id: task.id,
    ok: false,
    error: msg,
    failReasons: [msg],
    wallMs,
    usage: zeroUsage(),
    completionCount: 0,
    finalText: '',
    toolNames: [],
    toolTextConcat: '',
  }
}

/**
 * Child worker: seed wiki, run one JSONL case, write {@link RunAgentEvalCaseResult} to `EVAL_SUBPROCESS_REPORT_FILE`.
 * @returns exit code (0 = wrote report; 1 = fatal)
 */
export async function runWikiV1SubprocessWorker(): Promise<number> {
  const reportPath = process.env.EVAL_SUBPROCESS_REPORT_FILE?.trim()
  if (!reportPath) {
    console.error('[eval:wiki-v1:worker] EVAL_SUBPROCESS_REPORT_FILE is missing')
    return 1
  }

  const root = getEvalRepoRoot()
  const brain = resolveEvalBrainHome(root)
  process.env.BRAIN_HOME = brain
  const rip = join(brain, 'ripmail', 'ripmail.db')
  if (!existsSync(rip)) {
    console.error(`[eval:wiki-v1:worker] ripmail index missing. Run: npm run brain:seed-enron-demo (${rip})`)
    return 1
  }

  if (process.env.EVAL_RIPMAIL_SEND_DRY_RUN === undefined) {
    process.env.EVAL_RIPMAIL_SEND_DRY_RUN = '1'
  }

  const tasksPath = resolveWikiTaskFilePath(root)
  if (!existsSync(tasksPath)) {
    console.error(`[eval:wiki-v1:worker] Task file not found: ${tasksPath}`)
    return 1
  }

  const allTasks = await loadWikiV1TasksFromFile(tasksPath)
  const onlyId = process.env.EVAL_CASE_ID?.trim()
  const tasks = onlyId ? allTasks.filter(t => t.id === onlyId) : allTasks
  if (tasks.length !== 1) {
    console.error(
      `[eval:wiki-v1:worker] expected exactly one task for EVAL_CASE_ID=${JSON.stringify(onlyId)}, got ${tasks.length}`,
    )
    return 1
  }

  const task = tasks[0]!
  try {
    await runWithTenantContextAsync(
      { tenantUserId: '_single', workspaceHandle: '_single', homeDir: brain },
      async () => {
        await seedEnronEvalWiki()
        const result = await runWikiAgentEvalCase(task)
        writeFileSync(reportPath, JSON.stringify(result), 'utf-8')
      },
    )
    return 0
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[eval:wiki-v1:worker] ${msg}`)
    try {
      writeFileSync(
        reportPath,
        JSON.stringify(subprocessFail(task, msg)),
        'utf-8',
      )
      return 0
    } catch {
      return 1
    }
  }
}

async function runWikiEvalCaseSubprocess(
  task: WikiV1Task,
  tasksPathAbs: string,
): Promise<RunAgentEvalCaseResult> {
  const root = getEvalRepoRoot()
  const wikiParent = wikiEvalCaseBrainWikiParent(root, task.id)
  rmSync(wikiParent, { recursive: true, force: true })
  mkdirSync(wikiParent, { recursive: true })
  console.error(`[eval:wiki-v1] case vault (kept on disk): ${wikiParent}`)
  const reportPath = join(tmpdir(), `wiki-eval-report-${randomUUID()}.json`)
  const t0 = performance.now()
  try {
    const child = spawn(
      'npx',
      [
        'tsx',
        '--tsconfig',
        'tsconfig.server.json',
        join('src', 'server', 'evals', 'wikiV1cli.ts'),
        '--id',
        task.id,
        '--brain-wiki-root',
        wikiParent,
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          BRAIN_HOME: process.env.BRAIN_HOME,
          EVAL_WIKI_TASKS: tasksPathAbs,
          EVAL_CASE_ID: task.id,
          EVAL_SUBPROCESS_REPORT_FILE: reportPath,
          EVAL_RIPMAIL_SEND_DRY_RUN: process.env.EVAL_RIPMAIL_SEND_DRY_RUN ?? '1',
        },
        stdio: 'inherit',
      },
    )
    const [code] = await once(child, 'exit')
    const wallMs = performance.now() - t0
    try {
      const raw = readFileSync(reportPath, 'utf-8')
      const parsed = JSON.parse(raw) as RunAgentEvalCaseResult
      parsed.wallMs = parsed.wallMs ?? wallMs
      return parsed
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      const suffix = code !== 0 ? ` (subprocess exit ${code})` : ''
      return subprocessFail(task, `failed to read subprocess report: ${msg}${suffix}`, wallMs)
    }
  } finally {
    try {
      rmSync(reportPath, { force: true })
    } catch {
      /* ignore */
    }
  }
}

export async function runWikiV1Main(): Promise<number> {
  const evalRoot = getEvalRepoRoot()
  const bundlePaths = resolveWikiEvalBundlePaths(evalRoot)
  /** Subprocess worker must load the JSONL file that declares this task id. */
  const taskSourceAbsById = new Map<string, string>()
  for (const abs of bundlePaths) {
    const batch = await loadWikiV1TasksFromFile(abs)
    for (const t of batch) {
      if (taskSourceAbsById.has(t.id)) {
        console.error(`[eval:wiki-v1] duplicate task id across wiki bundles: ${JSON.stringify(t.id)}`)
        process.exit(1)
      }
      taskSourceAbsById.set(t.id, abs)
    }
  }
  const tasksPathAbsForType = bundlePaths[0]!
  return runLlmJsonlEvalMain<WikiV1Task>({
    logPrefix: '[eval:wiki-v1]',
    outSlug: 'wiki-v1',
    resolveTaskBundlePaths: root => resolveWikiEvalBundlePaths(root),
    resolveTaskFilePath: () => tasksPathAbsForType,
    loadTasks: loadWikiV1TasksFromFile,
    runCase: task => runWikiEvalCaseSubprocess(task, taskSourceAbsById.get(task.id) ?? tasksPathAbsForType),
    defaultMaxConcurrency: DEFAULT_EVAL_JSONL_CONCURRENCY,
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
    ripIndexHint: 'Run: npm run brain:seed-enron-demo',
  })
}
