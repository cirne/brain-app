import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

// Shared fixture: a temp wiki directory
let wikiDir: string

beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'tools-test-'))
  await mkdir(join(wikiDir, 'ideas'))
  await writeFile(join(wikiDir, 'ideas', 'foo.md'), '# Foo\nThis is a foo idea.')
  await writeFile(join(wikiDir, 'index.md'), '# Home\nWelcome to the wiki.')
  process.env.WIKI_DIR = wikiDir
})

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
  delete process.env.WIKI_DIR
})

describe('wikiTools.list_wiki_files', () => {
  it('returns all markdown files', async () => {
    const { wikiTools } = await import('./tools.js')
    const files = await wikiTools.list_wiki_files.execute({})
    expect(files).toContain('ideas/foo.md')
    expect(files).toContain('index.md')
  })
})

describe('wikiTools.read_wiki_file', () => {
  it('reads a valid file', async () => {
    const { wikiTools } = await import('./tools.js')
    const content = await wikiTools.read_wiki_file.execute({ path: 'index.md' })
    expect(content).toContain('# Home')
  })

  it('throws on path traversal', async () => {
    const { wikiTools } = await import('./tools.js')
    await expect(
      wikiTools.read_wiki_file.execute({ path: '../../etc/passwd' })
    ).rejects.toThrow('Path traversal denied')
  })
})
