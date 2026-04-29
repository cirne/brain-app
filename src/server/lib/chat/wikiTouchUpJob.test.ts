import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

vi.mock('@server/agent/wikiExpansionRunner.js', () => ({
  runCleanupInvocation: vi.fn().mockResolvedValue({
    editCount: 1,
    editedRelativePaths: ['people/alice.md'],
    telemetry: {
      latencyMs: 123,
      turnCount: 2,
      completionCount: 3,
      toolCallCount: 4,
      usage: {
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
        totalTokens: 100,
        costTotal: 0.05,
      },
    },
  }),
}))

vi.mock('@server/lib/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

let brainHome: string

beforeEach(async () => {
  vi.useFakeTimers()
  brainHome = await mkdtemp(join(tmpdir(), 'wiki-touch-up-job-test-'))
  process.env.BRAIN_HOME = brainHome
  const wikiRoot = join(brainHome, 'wiki')
  await mkdir(join(wikiRoot, 'people'), { recursive: true })
  await writeFile(join(wikiRoot, 'index.md'), '# Home\n', 'utf-8')
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  vi.clearAllMocks()
})

describe('enqueueWikiTouchUpAfterChatTurn', () => {
  it('forwards workspaceHandle to runCleanupInvocation for NR cost-by-handle', async () => {
    const { enqueueWikiTouchUpAfterChatTurn } = await import('./wikiTouchUpJob.js')
    const { runCleanupInvocation } = await import('@server/agent/wikiExpansionRunner.js')

    // Missing path avoids cheap-skip-only branch (plain `index.md` has no `[[` ⇒ would skip cleanup).
    enqueueWikiTouchUpAfterChatTurn({
      sessionId: 'session-nr-ws',
      changedFiles: ['index.md', 'touch-up-missing-anchor.md'],
      workspaceHandle: 'cost-by-handle-user',
    })

    await vi.advanceTimersByTimeAsync(401)

    await vi.waitFor(() => expect(runCleanupInvocation).toHaveBeenCalledTimes(1))
    expect(runCleanupInvocation).toHaveBeenCalledWith(
      'wiki-touch-up-session-nr-ws',
      expect.anything(),
      expect.objectContaining({ workspaceHandle: 'cost-by-handle-user' }),
    )
  })

  it('logs touch-up completion metrics', async () => {
    const { enqueueWikiTouchUpAfterChatTurn } = await import('./wikiTouchUpJob.js')
    const { runCleanupInvocation } = await import('@server/agent/wikiExpansionRunner.js')
    const { logger } = await import('@server/lib/observability/logger.js')

    enqueueWikiTouchUpAfterChatTurn({
      sessionId: 'session-aaa',
      changedFiles: ['index.md', 'people/alice.md'],
      timezone: 'America/Chicago',
    })

    await vi.advanceTimersByTimeAsync(401)

    await vi.waitFor(() => expect(runCleanupInvocation).toHaveBeenCalledTimes(1))
    const info = vi.mocked(logger.info)
    const completeCall = info.mock.calls.find(([, message]) => message === 'wiki-touch-up-complete')
    expect(completeCall).toBeTruthy()
    expect(completeCall?.[0]).toEqual(
      expect.objectContaining({
        sessionId: 'session-aaa',
        backgroundRunId: 'wiki-touch-up-session-aaa',
        cleanupLatencyMs: 123,
        anchorPathsCount: 2,
        editedPathsCount: 1,
        editCount: 1,
        pageCount: 1,
        turnCount: 2,
        completionCount: 3,
        toolCallCount: 4,
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 40,
        totalTokens: 100,
        costTotal: 0.05,
      }),
    )
    expect(completeCall?.[0]).toEqual(
      expect.objectContaining({
        latencyMs: expect.any(Number),
      }),
    )
  })

  it('does not invoke cleanup LLM when anchor files have no [[wikilink]] surface', async () => {
    const wikiRoot = join(brainHome, 'wiki')
    await writeFile(join(wikiRoot, 'plain-notes.md'), 'Only backlog bullets.\n', 'utf-8')

    const { enqueueWikiTouchUpAfterChatTurn } = await import('./wikiTouchUpJob.js')
    const { runCleanupInvocation } = await import('@server/agent/wikiExpansionRunner.js')
    const { logger } = await import('@server/lib/observability/logger.js')

    enqueueWikiTouchUpAfterChatTurn({
      sessionId: 'session-skip-plain',
      changedFiles: ['plain-notes.md'],
    })

    await vi.advanceTimersByTimeAsync(401)

    await vi.waitFor(() => expect(runCleanupInvocation).not.toHaveBeenCalled())
    await vi.waitFor(() => {
      const info = vi.mocked(logger.info)
      const skipLog = info.mock.calls.find(([, msg]) => msg === 'wiki-touch-up-skip-no-wikilink-surface')
      expect(skipLog).toBeTruthy()
    })

    expect(vi.mocked(logger.info).mock.calls.find(([, msg]) => msg === 'wiki-touch-up-skip-no-wikilink-surface')?.[
      0
    ]).toEqual(expect.objectContaining({ skippedNoWikilinkSurface: true }))
  })
})
