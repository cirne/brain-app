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

describe('createAgentTools', () => {
  it('returns an array of tools with expected names', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    expect(Array.isArray(tools)).toBe(true)
    const names = tools.map((t: any) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('edit')
    expect(names).toContain('write')
    expect(names).toContain('grep')
    expect(names).toContain('find')
    expect(names).toContain('search_email')
    expect(names).toContain('read_email')
    expect(names).toContain('git_commit_push')
  })

  it('read tool can read a wiki file', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const readTool = tools.find((t: any) => t.name === 'read')!
    const result = await readTool.execute('test-1', { path: 'index.md' })
    const text = result.content.map((c: any) => c.text).join('')
    expect(text).toContain('# Home')
  })

  it('grep tool can search wiki content', async () => {
    const { createAgentTools } = await import('./tools.js')
    const tools = createAgentTools(wikiDir)
    const grepTool = tools.find((t: any) => t.name === 'grep')!
    const result = await grepTool.execute('test-2', { pattern: 'foo idea', path: '.' })
    const text = result.content.map((c: any) => c.text).join('')
    expect(text).toContain('foo')
  })
})
