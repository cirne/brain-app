/**
 * Tests for BUG-011 fix: me.md, assistant.md, and vault manifest are injected
 * into the expansion context prefix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildExpansionContextPrefix } from './wikiExpansionRunner.js'

let wikiRoot: string

beforeEach(async () => {
  wikiRoot = await mkdtemp(join(tmpdir(), 'wiki-expansion-context-test-'))
})

afterEach(async () => {
  await rm(wikiRoot, { recursive: true, force: true })
})

describe('buildExpansionContextPrefix', () => {
  it('returns empty string when vault is empty and me.md is missing', async () => {
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).toBe('')
  })

  it('injects me.md content when the file exists (BUG-011 fix)', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Lewis Cirne\n\nBio line.', 'utf-8')
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).toContain('Lewis Cirne')
    expect(prefix).toContain('Bio line.')
    expect(prefix).toContain('me.md')
  })

  it('injects assistant.md when the file exists', async () => {
    await writeFile(join(wikiRoot, 'assistant.md'), '# Charter\n\nStay concise.', 'utf-8')
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).toContain('assistant.md')
    expect(prefix).toContain('Charter')
    expect(prefix).toContain('Stay concise.')
  })

  it('includes both me.md and assistant.md when both exist', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me\n\nUser.', 'utf-8')
    await writeFile(join(wikiRoot, 'assistant.md'), '# Asst\n\nRules.', 'utf-8')
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).toContain('User.')
    expect(prefix).toContain('Rules.')
    expect(prefix.indexOf('User.')).toBeLessThan(prefix.indexOf('Rules.'))
  })

  it('injects vault manifest listing existing pages', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me', 'utf-8')
    await mkdir(join(wikiRoot, 'people'), { recursive: true })
    await writeFile(join(wikiRoot, 'people', 'alice.md'), '# Alice', 'utf-8')
    await writeFile(join(wikiRoot, 'projects', 'foo.md'), '# Foo', 'utf-8').catch(() => {
      // projects dir may not exist
    })
    await mkdir(join(wikiRoot, 'projects'), { recursive: true })
    await writeFile(join(wikiRoot, 'projects', 'foo.md'), '# Foo', 'utf-8')

    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).toContain('me.md')
    expect(prefix).toContain('people/alice.md')
    expect(prefix).toContain('projects/foo.md')
    expect(prefix).toContain('Existing wiki pages')
  })

  it('does not include hidden directories in the manifest', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me', 'utf-8')
    await mkdir(join(wikiRoot, '.obsidian'), { recursive: true })
    await writeFile(join(wikiRoot, '.obsidian', 'hidden.md'), '# Hidden', 'utf-8')

    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).not.toContain('.obsidian')
    expect(prefix).not.toContain('hidden.md')
  })

  it('includes a disambiguating header so the model knows this is injected context', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me\n\nSome content.', 'utf-8')
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).toMatch(/Injected context/i)
  })

  it('ends with a separator so the user task message is clearly delimited', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me', 'utf-8')
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix.trimEnd()).toMatch(/---$/)
  })

  it('includes syncNote when provided, under a Data freshness heading', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me', 'utf-8')
    const note = 'Mail was synced. Focus on gaps, not just recent events.'
    const prefix = await buildExpansionContextPrefix(wikiRoot, note)
    expect(prefix).toContain('Data freshness')
    expect(prefix).toContain(note)
  })

  it('does not include a Data freshness section when syncNote is omitted', async () => {
    await writeFile(join(wikiRoot, 'me.md'), '# Me', 'utf-8')
    const prefix = await buildExpansionContextPrefix(wikiRoot)
    expect(prefix).not.toContain('Data freshness')
  })
})
