/**
 * Debounced enqueue + execute post-chat wiki polish (cleanup) runs.
 * One stable BackgroundRunDoc id per chat session powers GET /api/chat/wiki-touch-up/:sessionId.
 */
import {
  touchRun,
  writeBackgroundRun,
  readBackgroundRun,
  type BackgroundRunDoc,
} from './backgroundAgentStore.js'
import { runCleanupInvocation } from '@server/agent/wikiExpansionRunner.js'
import { listWikiFiles } from '@server/lib/wiki/wikiFiles.js'
import { wikiDir } from '@server/lib/wiki/wikiDir.js'
import { shouldSkipWikiTouchUpCheapCheck } from '@server/lib/chat/wikiTouchUpCheapSkip.js'
import { logger } from '@server/lib/observability/logger.js'

const DEBOUNCE_MS = 400

const pending = new Map<
  string,
  {
    paths: Set<string>
    timer: ReturnType<typeof setTimeout>
    timezone?: string
    /** From chat turn telemetry; ALS is gone when the debounced run fires. */
    workspaceHandle?: string
  }
>()

function docIdForSession(sessionId: string): string {
  return `wiki-touch-up-${sessionId}`
}

/** Stable BackgroundRunDoc id — match GET /api/chat/wiki-touch-up/:sessionId polls. */
export function wikiTouchUpBackgroundRunId(sessionId: string): string {
  return docIdForSession(sessionId)
}

/**
 * Debounce-merge paths for the session; schedules a single polish run shortly after edits settle.
 */
export function enqueueWikiTouchUpAfterChatTurn(args: {
  sessionId: string
  changedFiles: readonly string[]
  timezone?: string
  workspaceHandle?: string
}): void {
  const sessionId = args.sessionId
  const next = [...new Set(args.changedFiles)].filter((p) => p.length > 0)
  if (next.length === 0) return

  const cur = pending.get(sessionId)
  if (cur) {
    clearTimeout(cur.timer)
    for (const p of next) cur.paths.add(p)
    cur.timezone = args.timezone ?? cur.timezone
    if (args.workspaceHandle !== undefined) cur.workspaceHandle = args.workspaceHandle
    cur.timer = scheduleFlush(sessionId)
    return
  }
  const paths = new Set(next)
  pending.set(sessionId, {
    paths,
    timezone: args.timezone,
    workspaceHandle: args.workspaceHandle,
    timer: scheduleFlush(sessionId),
  })
}

function scheduleFlush(sessionId: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    void flushPending(sessionId)
  }, DEBOUNCE_MS)
}

async function flushPending(sessionId: string): Promise<void> {
  const rec = pending.get(sessionId)
  if (!rec) return
  pending.delete(sessionId)
  const merged = [...rec.paths].sort()
  if (merged.length === 0) return
  await runWikiTouchUpForSession(sessionId, merged, rec.timezone, rec.workspaceHandle)
}

async function runWikiTouchUpForSession(
  sessionId: string,
  anchorPaths: string[],
  timezone?: string,
  workspaceHandle?: string,
): Promise<void> {
  const startedAt = performance.now()
  const runId = docIdForSession(sessionId)
  const wikiRoot = wikiDir()
  const pageCount = (await listWikiFiles(wikiRoot)).length
  const now = new Date().toISOString()

  let doc: BackgroundRunDoc = (await readBackgroundRun(runId)) ?? {
    id: runId,
    kind: 'wiki-touch-up',
    status: 'queued',
    label: 'Wiki polish',
    detail: 'Queued…',
    pageCount,
    logLines: [],
    logEntries: [],
    timeline: [],
    startedAt: now,
    updatedAt: now,
    chatSessionId: sessionId,
    wikiTouchUpAnchorPaths: anchorPaths,
  }

  if (await shouldSkipWikiTouchUpCheapCheck(wikiRoot, anchorPaths)) {
    touchRun(doc, {
      kind: 'wiki-touch-up',
      status: 'completed',
      label: 'Wiki polish',
      detail: 'Skipped — no [[wikilinks]] in edited files',
      pageCount,
      wikiTouchUpAnchorPaths: anchorPaths,
      wikiTouchUpEditedPaths: [],
      chatSessionId: sessionId,
      error: undefined,
    })
    await writeBackgroundRun(doc)

    logger.info(
      {
        sessionId,
        backgroundRunId: runId,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        anchorPathsCount: anchorPaths.length,
        pageCount,
        skippedNoWikilinkSurface: true,
      },
      'wiki-touch-up-skip-no-wikilink-surface',
    )
    return
  }

  touchRun(doc, {
    kind: 'wiki-touch-up',
    status: 'running',
    label: 'Wiki polish',
    detail: 'Polishing wiki…',
    pageCount,
    wikiTouchUpAnchorPaths: anchorPaths,
    wikiTouchUpEditedPaths: undefined,
    chatSessionId: sessionId,
    error: undefined,
  })
  await writeBackgroundRun(doc)

  logger.info(
    {
      sessionId,
      backgroundRunId: runId,
      anchorPaths,
      anchorPathsCount: anchorPaths.length,
      pageCount,
      timezone: timezone ?? 'UTC',
    },
    'wiki-touch-up-start',
  )

  try {
    const result = await runCleanupInvocation(runId, doc, {
      timezone,
      changedFiles: anchorPaths,
      trigger: 'post_chat_turn',
      attachRunTrackerSource: 'wikiTouchUp',
      workspaceHandle,
    })
    const updatedPageCount = (await listWikiFiles(wikiRoot)).length

    touchRun(doc, {
      status: 'completed',
      detail: result.editCount > 0 ? `Updated ${result.editCount} path(s)` : 'No edits needed',
      wikiTouchUpEditedPaths: result.editedRelativePaths,
      pageCount: updatedPageCount,
    })
    await writeBackgroundRun(doc)
    logger.info(
      {
        sessionId,
        backgroundRunId: runId,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        cleanupLatencyMs: result.telemetry.latencyMs,
        anchorPathsCount: anchorPaths.length,
        editedPathsCount: result.editedRelativePaths.length,
        editCount: result.editCount,
        pageCount: updatedPageCount,
        turnCount: result.telemetry.turnCount,
        completionCount: result.telemetry.completionCount,
        toolCallCount: result.telemetry.toolCallCount,
        inputTokens: result.telemetry.usage.input,
        outputTokens: result.telemetry.usage.output,
        cacheReadTokens: result.telemetry.usage.cacheRead,
        cacheWriteTokens: result.telemetry.usage.cacheWrite,
        totalTokens: result.telemetry.usage.totalTokens,
        costTotal: result.telemetry.usage.costTotal,
      },
      'wiki-touch-up-complete',
    )
  } catch (e: unknown) {
    logger.error(
      {
        err: e,
        sessionId,
        runId,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        anchorPathsCount: anchorPaths.length,
      },
      'wiki-touch-up failed',
    )
    const msg = e instanceof Error ? e.message : String(e)
    touchRun(doc, { status: 'error', detail: msg, error: msg })
    await writeBackgroundRun(doc).catch(() => {})
  }
}
