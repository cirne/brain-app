import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@server/ripmail/index.js', () => ({
  ripmailResolveEntryJson: vi.fn(),
}))

import { ripmailResolveEntryJson } from '@server/ripmail/index.js'
import {
  mergeIndexedOpenFilesIntoChatContext,
  INDEXED_OPEN_FILE_CONTEXT_MAX_CHARS,
} from './chatIndexedOpenContext.js'

describe('mergeIndexedOpenFilesIntoChatContext', () => {
  beforeEach(() => {
    vi.mocked(ripmailResolveEntryJson).mockReset()
  })

  it('returns base unchanged when resolver returns null', async () => {
    vi.mocked(ripmailResolveEntryJson).mockResolvedValueOnce(null)
    const out = await mergeIndexedOpenFilesIntoChatContext('hello', [{ id: 'x' }], '/tmp/r')
    expect(out).toBe('hello')
  })

  it('appends extracted text when resolver returns indexed-file', async () => {
    vi.mocked(ripmailResolveEntryJson).mockResolvedValueOnce({
      entryKind: 'indexed-file',
      id: 'file1',
      sourceKind: 'googleDrive',
      title: 'Sheet',
      body: 'a,b\n1,2',
      mime: 'text/csv',
      readStatus: 'ok',
    })
    const out = await mergeIndexedOpenFilesIntoChatContext(undefined, [{ id: 'file1', source: 's1' }], '/tmp/r')
    expect(out).toContain('Open indexed document')
    expect(out).toContain('Sheet')
    expect(out).toContain('a,b')
    expect(out).toContain('ripmail source: `s1`')
    expect(ripmailResolveEntryJson).toHaveBeenCalledWith('/tmp/r', 'file1', { sourceId: 's1' })
  })

  it('truncates very large bodies', async () => {
    const huge = 'x'.repeat(INDEXED_OPEN_FILE_CONTEXT_MAX_CHARS + 500)
    vi.mocked(ripmailResolveEntryJson).mockResolvedValueOnce({
      entryKind: 'indexed-file',
      id: 'f',
      sourceKind: 'googleDrive',
      title: 'Big',
      body: huge,
      mime: 'text/csv',
      readStatus: 'ok',
    })
    const out = await mergeIndexedOpenFilesIntoChatContext(undefined, [{ id: 'f' }], '/tmp/r')
    expect(out!.length).toBeLessThan(huge.length + 400)
    expect(out).toContain('truncated')
  })
})
