import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeWikiPartialFromStreamingWriteArgs } from './wikiStreamingPartialWrite.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wiki-stream-partial-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeWikiPartialFromStreamingWriteArgs', () => {
  it('writes empty file when path is known but content is not a string yet', async () => {
    await writeWikiPartialFromStreamingWriteArgs(dir, 'write', { path: 'notes/a.md' })
    const text = await readFile(join(dir, 'notes/a.md'), 'utf-8')
    expect(text).toBe('')
  })

  it('overwrites with growing content', async () => {
    await writeWikiPartialFromStreamingWriteArgs(dir, 'write', { path: 'x.md', content: '# ' })
    await writeWikiPartialFromStreamingWriteArgs(dir, 'write', { path: 'x.md', content: '# Hello' })
    expect(await readFile(join(dir, 'x.md'), 'utf-8')).toBe('# Hello')
  })

  it('ignores non-write tools', async () => {
    await writeWikiPartialFromStreamingWriteArgs(dir, 'edit', { path: 'x.md', content: 'y' })
    await expect(readFile(join(dir, 'x.md'), 'utf-8')).rejects.toThrow()
  })

  it('ignores path traversal', async () => {
    await writeWikiPartialFromStreamingWriteArgs(dir, 'write', { path: '../../../etc/passwd', content: 'x' })
    await expect(readFile(join(dir, 'etc', 'passwd'), 'utf-8')).rejects.toThrow()
  })

  it('does not create a file for incomplete streamed paths (e.g. directory prefix before .md)', async () => {
    await writeWikiPartialFromStreamingWriteArgs(dir, 'write', { path: 'trips' })
    await expect(access(join(dir, 'trips'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('writes nested path once .md suffix is present', async () => {
    await writeWikiPartialFromStreamingWriteArgs(dir, 'write', {
      path: 'trips/2026-04-18-sterlings-wedding.md',
      content: '# x',
    })
    expect(await readFile(join(dir, 'trips', '2026-04-18-sterlings-wedding.md'), 'utf-8')).toBe('# x')
  })
})
