import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('wikiEditHistory', () => {
  let tmp: string
  let histPath: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wiki-edit-hist-'))
    histPath = join(tmp, 'wiki-edits.jsonl')
    process.env.WIKI_EDIT_HISTORY_PATH = histPath
  })

  afterEach(async () => {
    delete process.env.WIKI_EDIT_HISTORY_PATH
    await rm(tmp, { recursive: true, force: true })
  })

  it('readRecentWikiEdits returns empty when file missing', async () => {
    const { readRecentWikiEdits } = await import('./wikiEditHistory.js')
    const files = await readRecentWikiEdits(10)
    expect(files).toEqual([])
  })

  it('dedupes by path keeping the newest timestamp', async () => {
    await writeFile(
      histPath,
      [
        JSON.stringify({ ts: '2026-04-10T12:00:00.000Z', op: 'edit', path: 'a.md', source: 'agent' }),
        JSON.stringify({ ts: '2026-04-13T12:00:00.000Z', op: 'write', path: 'b.md', source: 'agent' }),
        JSON.stringify({ ts: '2026-04-11T00:00:00.000Z', op: 'edit', path: 'a.md', source: 'agent' }),
      ].join('\n') + '\n',
      'utf8'
    )
    const { readRecentWikiEdits } = await import('./wikiEditHistory.js')
    const files = await readRecentWikiEdits(10)
    expect(files.map((f) => f.path)).toEqual(['b.md', 'a.md'])
    expect(files[0].date).toBe('2026-04-13')
    expect(files[1].date).toBe('2026-04-11')
  })

  it('normalizeWikiRelativePath produces forward slashes relative to wiki root', async () => {
    const { normalizeWikiRelativePath } = await import('./wikiEditHistory.js')
    const wikiDir = join(tmp, 'wiki')
    expect(normalizeWikiRelativePath(wikiDir, join(wikiDir, 'people', 'x.md'))).toBe('people/x.md')
  })
})
