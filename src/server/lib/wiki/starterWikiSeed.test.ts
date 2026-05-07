import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

describe('ensureStarterWikiSeed', () => {
  let dir: string
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const bundle = join(repoRoot, 'assets', 'starter-wiki')

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'starter-wiki-seed-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('copies starter files when bundle exists and skips existing paths on second run', async () => {
    if (!existsSync(bundle)) {
      return
    }
    process.env.BRAIN_STARTER_WIKI_BUNDLE = bundle
    const { ensureStarterWikiSeed } = await import('./starterWikiSeed.js')

    const first = await ensureStarterWikiSeed(dir)
    expect(first.copied.length).toBeGreaterThan(0)
    expect(existsSync(join(dir, 'index.md'))).toBe(true)
    expect(existsSync(join(dir, 'people/template.md'))).toBe(true)
    expect(existsSync(join(dir, 'travel/template.md'))).toBe(true)
    expect(existsSync(join(dir, 'travel/archive/template.md'))).toBe(true)
    expect(existsSync(join(dir, 'notes/archive/template.md'))).toBe(true)
    expect(existsSync(join(dir, 'me.md'))).toBe(true)
    const meRaw = await readFile(join(dir, 'me.md'), 'utf-8')
    expect(meRaw).toContain('injected into every chat')

    const touchPath = join(dir, 'people/template.md')
    await writeFile(touchPath, '# user-owned template\n', 'utf-8')
    await writeFile(join(dir, 'me.md'), '# customized me — do not overwrite\n', 'utf-8')

    const second = await ensureStarterWikiSeed(dir)
    expect(second.copied).toEqual([])
    const raw = await readFile(touchPath, 'utf-8')
    expect(raw).toBe('# user-owned template\n')
    expect(await readFile(join(dir, 'me.md'), 'utf-8')).toBe('# customized me — do not overwrite\n')

    delete process.env.BRAIN_STARTER_WIKI_BUNDLE
  })
})
