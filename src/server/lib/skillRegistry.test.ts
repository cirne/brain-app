import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'skill-reg-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('listSkills', () => {
  it('lists skills from skillsDir with stable sort', async () => {
    const skillsRoot = join(brainHome, 'skills')
    await mkdir(join(skillsRoot, 'zebra'), { recursive: true })
    await mkdir(join(skillsRoot, 'apple'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'zebra', 'SKILL.md'),
      `---
name: zebra
label: Z
description: Last alphabetically but sorted by name field.
---
`,
      'utf-8',
    )
    await writeFile(
      join(skillsRoot, 'apple', 'SKILL.md'),
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
