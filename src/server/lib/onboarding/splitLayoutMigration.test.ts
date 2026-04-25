import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import {
  migrateOpp024WikiFromLegacy,
  OPP024_SPLIT_MARKER,
} from './splitLayoutMigration.js'

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'opp024-mig-'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('migrateOpp024WikiFromLegacy', () => {
  it('moves legacy wiki into empty target', async () => {
    const local = join(base, 'local')
    const legacy = join(local, 'wiki')
    const target = join(base, 'Documents', 'Brain', 'wiki')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'a.md'), '# hi', 'utf-8')

    await migrateOpp024WikiFromLegacy({
      localRoot: local,
      legacyWiki: legacy,
      targetWiki: target,
      wikiDirName: 'wiki',
    })

    expect(existsSync(legacy)).toBe(false)
    expect(await readFile(join(target, 'a.md'), 'utf-8')).toBe('# hi')
    expect(existsSync(join(local, OPP024_SPLIT_MARKER))).toBe(true)
  })

  it('replaces empty target with legacy content', async () => {
    const local = join(base, 'local')
    const legacy = join(local, 'wiki')
    const target = join(base, 'Documents', 'Brain', 'wiki')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'b.md'), 'x', 'utf-8')
    await mkdir(target, { recursive: true })

    await migrateOpp024WikiFromLegacy({
      localRoot: local,
      legacyWiki: legacy,
      targetWiki: target,
      wikiDirName: 'wiki',
    })

    expect(existsSync(legacy)).toBe(false)
    expect(await readFile(join(target, 'b.md'), 'utf-8')).toBe('x')
  })

  it('renames legacy when both trees have content', async () => {
    const local = join(base, 'local')
    const legacy = join(local, 'wiki')
    const target = join(base, 'Documents', 'Brain', 'wiki')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'old.md'), 'o', 'utf-8')
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'new.md'), 'n', 'utf-8')

    await migrateOpp024WikiFromLegacy({
      localRoot: local,
      legacyWiki: legacy,
      targetWiki: target,
      wikiDirName: 'wiki',
    })

    expect(existsSync(legacy)).toBe(false)
    expect(await readFile(join(target, 'new.md'), 'utf-8')).toBe('n')
    const escape = join(local, 'wiki-legacy-from-app-support')
    expect(existsSync(escape)).toBe(true)
    expect(await readFile(join(escape, 'old.md'), 'utf-8')).toBe('o')
  })

  it('no-op when marker already present', async () => {
    const local = join(base, 'local')
    const legacy = join(local, 'wiki')
    const target = join(base, 'Documents', 'Brain', 'wiki')
    await mkdir(legacy, { recursive: true })
    await writeFile(join(legacy, 'x.md'), 'x', 'utf-8')
    await writeFile(join(local, OPP024_SPLIT_MARKER), '', 'utf-8')

    await migrateOpp024WikiFromLegacy({
      localRoot: local,
      legacyWiki: legacy,
      targetWiki: target,
      wikiDirName: 'wiki',
    })

    expect(existsSync(legacy)).toBe(true)
  })
})
