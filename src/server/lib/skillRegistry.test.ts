import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let wikiDir: string

beforeEach(async () => {
  wikiDir = await mkdtemp(join(tmpdir(), 'skill-reg-'))
  process.env.WIKI_DIR = wikiDir
})

afterEach(async () => {
  await rm(wikiDir, { recursive: true, force: true })
  delete process.env.WIKI_DIR
})

describe('listSkills', () => {
  it('lists skills from skillsDir with stable sort', async () => {
    await mkdir(join(wikiDir, 'skills', 'zebra'), { recursive: true })
    await mkdir(join(wikiDir, 'skills', 'apple'), { recursive: true })
    await writeFile(
      join(wikiDir, 'skills', 'zebra', 'SKILL.md'),
      `---
name: zebra
label: Z
description: Last alphabetically but sorted by name field.
---
`,
      'utf-8',
    )
    await writeFile(
      join(wikiDir, 'skills', 'apple', 'SKILL.md'),
      `---
name: apple
label: A
description: First.
---
`,
      'utf-8',
    )

    const { listSkills } = await import('./skillRegistry.js')
    const list = await listSkills()
    expect(list.map(s => s.name)).toEqual(['apple', 'zebra'])
  })
})
