import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeWikiPartialFromStreamingWriteArgs } from './wikiStreamingPartialWrite.js'

describe('writeWikiPartialFromStreamingWriteArgs', () => {
  it('writes to kebab-normalized path for new files under a subdirectory', async () => {
    const wiki = mkdtempSync(join(tmpdir(), 'wiki-partial-'))
    try {
      await writeWikiPartialFromStreamingWriteArgs(wiki, 'write', {
        path: 'topics/Cool Page Name.md',
        content: 'partial',
      })
      const raw = readFileSync(join(wiki, 'topics', 'cool-page-name.md'), 'utf-8')
      expect(raw).toBe('partial')
    } finally {
      rmSync(wiki, { recursive: true, force: true })
    }
  })

  it('does not persist partial writes for disallowed vault-root markdown', async () => {
    const wiki = mkdtempSync(join(tmpdir(), 'wiki-partial-'))
    try {
      await writeWikiPartialFromStreamingWriteArgs(wiki, 'write', {
        path: 'Cool Page Name.md',
        content: 'partial',
      })
      expect(existsSync(join(wiki, 'cool-page-name.md'))).toBe(false)
    } finally {
      rmSync(wiki, { recursive: true, force: true })
    }
  })
})
