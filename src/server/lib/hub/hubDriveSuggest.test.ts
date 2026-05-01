import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@server/lib/ripmail/ripmailRun.js', () => ({
  execRipmailAsync: vi.fn(),
  runRipmailArgv: vi.fn(),
}))

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: vi.fn(),
}))

vi.mock('@server/lib/llm/resolveModel.js', () => ({
  resolveModel: vi.fn(() => ({ provider: 'openai', id: 'gpt-5.4-mini' })),
  resolveLlmApiKey: vi.fn(() => 'test-key'),
}))

vi.mock('@server/lib/llm/llmOnPayloadChain.js', () => ({
  chainLlmOnPayload: vi.fn(),
}))

import { runRipmailArgv, type RipmailRunResult } from '@server/lib/ripmail/ripmailRun.js'
import { completeSimple } from '@mariozechner/pi-ai'
import { suggestDriveFolders } from './hubDriveSuggest.js'

function ripmailOk(stdout: string, stderr = ''): RipmailRunResult {
  return { stdout, stderr, code: 0, signal: null, durationMs: 1, timedOut: false, pid: 1 }
}

const FOLDERS = [
  { id: 'f1', name: 'Projects', hasChildren: true },
  { id: 'f2', name: 'Photos', hasChildren: false },
  { id: 'f3', name: 'Notes', hasChildren: false },
]

function browseFoldersOutput() {
  return ripmailOk(JSON.stringify({ folders: FOLDERS }))
}

function llmJsonResponse(suggested: object[], ignoreGlobs: string[]) {
  const json = JSON.stringify({ suggested, ignoreGlobs })
  return {
    stopReason: 'end_turn',
    content: [{ type: 'text', text: json }],
  }
}

describe('suggestDriveFolders', () => {
  beforeEach(() => {
    vi.mocked(runRipmailArgv).mockReset()
    vi.mocked(completeSimple).mockReset()
  })

  it('returns suggestions with include flags from LLM', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue(browseFoldersOutput())
    vi.mocked(completeSimple).mockResolvedValue(
      llmJsonResponse(
        [
          { id: 'f1', name: 'Projects', reason: 'Work documents', include: true },
          { id: 'f2', name: 'Photos', reason: 'Media files', include: false },
          { id: 'f3', name: 'Notes', reason: 'Personal notes', include: true },
        ],
        ['*.tmp', '~$*'],
      ) as never,
    )

    const result = await suggestDriveFolders('drive_x')
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.suggestions).toHaveLength(3)
    expect(result.suggestions.find((s) => s.id === 'f1')?.include).toBe(true)
    expect(result.suggestions.find((s) => s.id === 'f2')?.include).toBe(false)
    expect(result.suggestions.find((s) => s.id === 'f3')?.include).toBe(true)
    expect(result.ignoreGlobs).toEqual(['*.tmp', '~$*'])
  })

  it('returns empty suggestions when Drive has no folders', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue(ripmailOk(JSON.stringify({ folders: [] })))

    const result = await suggestDriveFolders('drive_x')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestions).toHaveLength(0)
    expect(result.ignoreGlobs).toHaveLength(0)
  })

  it('returns ok:false when browse-folders fails', async () => {
    vi.mocked(runRipmailArgv).mockRejectedValue(new Error('ripmail error'))

    const result = await suggestDriveFolders('drive_x')
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when LLM returns error', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue(browseFoldersOutput())
    vi.mocked(completeSimple).mockResolvedValue({
      stopReason: 'error',
      errorMessage: 'LLM unavailable',
      content: [],
    } as never)

    const result = await suggestDriveFolders('drive_x')
    expect(result.ok).toBe(false)
  })

  it('filters out suggestions for unknown folder ids', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue(browseFoldersOutput())
    vi.mocked(completeSimple).mockResolvedValue(
      llmJsonResponse(
        [
          { id: 'f1', name: 'Projects', reason: 'Work', include: true },
          { id: 'unknown-id', name: 'Ghost', reason: 'Not in Drive', include: true },
        ],
        [],
      ) as never,
    )

    const result = await suggestDriveFolders('drive_x')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestions.map((s) => s.id)).not.toContain('unknown-id')
    expect(result.suggestions.map((s) => s.id)).toContain('f1')
  })

  it('handles LLM response wrapped in markdown code fences', async () => {
    vi.mocked(runRipmailArgv).mockResolvedValue(browseFoldersOutput())
    const raw = JSON.stringify({
      suggested: [{ id: 'f1', name: 'Projects', reason: 'Work docs', include: true }],
      ignoreGlobs: [],
    })
    vi.mocked(completeSimple).mockResolvedValue({
      stopReason: 'end_turn',
      content: [{ type: 'text', text: '```json\n' + raw + '\n```' }],
    } as never)

    const result = await suggestDriveFolders('drive_x')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.suggestions[0].id).toBe('f1')
  })

  it('returns ok:false when id is empty', async () => {
    const result = await suggestDriveFolders('')
    expect(result.ok).toBe(false)
  })
})
