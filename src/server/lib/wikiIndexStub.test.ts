import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureWikiIndexMdStub, WIKI_INDEX_STUB_MARKER } from './wikiIndexStub.js'

describe('ensureWikiIndexMdStub', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wiki-index-stub-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates index.md with me wikilink and directory section', async () => {
    const { created } = await ensureWikiIndexMdStub(dir)
    expect(created).toBe(true)
    const raw = await readFile(join(dir, 'index.md'), 'utf-8')
    expect(raw).toContain('[[me]]')
    expect(raw).toContain(WIKI_INDEX_STUB_MARKER)
    expect(raw).toContain('## Directories')
    expect(raw).toContain('people/')
    expect(raw).toContain('projects/')
  })

  it('adds account-holder people wikilink when provided', async () => {
    await ensureWikiIndexMdStub(dir, { accountHolderPeopleWikilink: 'people/jane-doe' })
    const raw = await readFile(join(dir, 'index.md'), 'utf-8')
    expect(raw).toContain('[[people/jane-doe]]')
  })

  it('does not overwrite existing index.md', async () => {
    await writeFile(join(dir, 'index.md'), '# Custom\n', 'utf-8')
    const { created } = await ensureWikiIndexMdStub(dir)
    expect(created).toBe(false)
    const raw = await readFile(join(dir, 'index.md'), 'utf-8')
    expect(raw).toBe('# Custom\n')
  })
})
