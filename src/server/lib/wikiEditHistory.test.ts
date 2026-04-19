import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('wikiEditHistory', () => {
  let tmp: string
  let histPath: string

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'wiki-edit-hist-'))
    process.env.BRAIN_HOME = tmp
    await mkdir(join(tmp, 'var'), { recursive: true })
    histPath = join(tmp, 'var', 'wiki-edits.jsonl')
  })

  afterEach(async () => {
    delete process.env.BRAIN_HOME
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
    expect(files[0].date).toBe('2026-04-13T12:00:00.000Z')
    expect(files[1].date).toBe('2026-04-11T00:00:00.000Z')
  })

  it('normalizeWikiRelativePath produces forward slashes relative to wiki root', async () => {
    const { normalizeWikiRelativePath } = await import('./wikiEditHistory.js')
    const wdir = join(tmp, 'wiki')
    expect(normalizeWikiRelativePath(wdir, join(wdir, 'people', 'x.md'))).toBe('people/x.md')
  })

  it('resolveSafeWikiPath throws on escape or wiki root', async () => {
    const { resolveSafeWikiPath } = await import('./wikiEditHistory.js')
    const wdir = join(tmp, 'wiki-root')
    expect(() => resolveSafeWikiPath(wdir, '../../../etc/passwd')).toThrow('wiki directory')
    expect(() => resolveSafeWikiPath(wdir, '.')).toThrow('wiki directory')
  })
})
