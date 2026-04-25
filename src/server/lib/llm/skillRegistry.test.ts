import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let brainHome: string
let emptyBundle: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'skill-reg-'))
  emptyBundle = await mkdtemp(join(tmpdir(), 'skill-bundle-empty-'))
  process.env.BRAIN_HOME = brainHome
  process.env.BRAIN_USER_SKILLS_BUNDLE = emptyBundle
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  await rm(emptyBundle, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  delete process.env.BRAIN_USER_SKILLS_BUNDLE
})

describe('listSkills', () => {
  it('lists skills from skillsDir with stable sort (bundle empty)', async () => {
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

    const { listSkills } = await import('@server/lib/llm/skillRegistry.js')
    const list = await listSkills()
    expect(list.map(s => s.name)).toEqual(['apple', 'zebra'])
    expect(list.map(s => s.slug).sort()).toEqual(['apple', 'zebra'])
  })

  it('merges bundled skills when no user copy exists', async () => {
    const bundle = await mkdtemp(join(tmpdir(), 'skill-bundle-'))
    try {
      await mkdir(join(bundle, 'beta'), { recursive: true })
      await writeFile(
        join(bundle, 'beta', 'SKILL.md'),
        `---
name: beta
description: From bundle.
---
`,
        'utf-8',
      )
      process.env.BRAIN_USER_SKILLS_BUNDLE = bundle

      const { listSkills } = await import('@server/lib/llm/skillRegistry.js')
      const list = await listSkills()
      expect(list.map(s => s.name)).toEqual(['beta'])
    } finally {
      process.env.BRAIN_USER_SKILLS_BUNDLE = emptyBundle
      await rm(bundle, { recursive: true, force: true })
    }
  })

  it('user skills/ slug overrides same slug in bundle (metadata and readSkillMarkdown)', async () => {
    const bundle = await mkdtemp(join(tmpdir(), 'skill-bundle-'))
    try {
      await mkdir(join(bundle, 'dup'), { recursive: true })
      await writeFile(
        join(bundle, 'dup', 'SKILL.md'),
        `---
name: dup
description: Bundled.
---
Body bundle.`,
        'utf-8',
      )
      process.env.BRAIN_USER_SKILLS_BUNDLE = bundle

      const userSkills = join(brainHome, 'skills', 'dup')
      await mkdir(userSkills, { recursive: true })
      await writeFile(
        join(userSkills, 'SKILL.md'),
        `---
name: dup
description: User win.
---
Body user.`,
        'utf-8',
      )

      const { listSkills } = await import('@server/lib/llm/skillRegistry.js')
      const list = await listSkills()
      expect(list).toHaveLength(1)
      expect(list[0].slug).toBe('dup')
      expect(list[0].description).toBe('User win.')

      const { readSkillMarkdown } = await import('@server/lib/llm/slashSkill.js')
      const doc = await readSkillMarkdown('dup')
      expect(doc?.body).toContain('Body user.')
    } finally {
      process.env.BRAIN_USER_SKILLS_BUNDLE = emptyBundle
      await rm(bundle, { recursive: true, force: true })
    }
  })
})

describe('formatSkillLibrarySection', () => {
  it('returns empty string when there are no skills', async () => {
    const { formatSkillLibrarySection } = await import('@server/lib/llm/skillRegistry.js')
    const text = await formatSkillLibrarySection()
    expect(text).toBe('')
  })

  it('includes heading, load_skill instruction, and one bullet per skill', async () => {
    const skillsRoot = join(brainHome, 'skills')
    await mkdir(join(skillsRoot, 'demo'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'demo', 'SKILL.md'),
      `---
name: Demo Skill
description: Short.
---
`,
      'utf-8',
    )
    const { formatSkillLibrarySection } = await import('@server/lib/llm/skillRegistry.js')
    const text = await formatSkillLibrarySection()
    expect(text).toContain('## Available specialized skills')
    expect(text).toContain('**load_skill**')
    expect(text).toMatch(/\*\*demo\*\*/)
    expect(text).toContain('Demo Skill')
    expect(text).toContain('Short.')
  })

  it('truncates long descriptions in the library line', async () => {
    const longDesc = 'A'.repeat(300)
    const skillsRoot = join(brainHome, 'skills')
    await mkdir(join(skillsRoot, 'longdesc'), { recursive: true })
    await writeFile(
      join(skillsRoot, 'longdesc', 'SKILL.md'),
      `---
name: longdesc
description: ${longDesc}
---
`,
      'utf-8',
    )
    const { formatSkillLibrarySection } = await import('@server/lib/llm/skillRegistry.js')
    const text = await formatSkillLibrarySection()
    expect(text.length).toBeLessThan(longDesc.length + 500)
    expect(text).toContain('…')
  })
})

describe('readSkillMarkdown', () => {
  it('resolves from bundle when user has no override', async () => {
    const bundle = await mkdtemp(join(tmpdir(), 'skill-bundle-'))
    try {
      await mkdir(join(bundle, 'gamma'), { recursive: true })
      await writeFile(
        join(bundle, 'gamma', 'SKILL.md'),
        `---
name: Gamma
---
Only in bundle`,
        'utf-8',
      )
      process.env.BRAIN_USER_SKILLS_BUNDLE = bundle

      const { readSkillMarkdown } = await import('@server/lib/llm/slashSkill.js')
      const doc = await readSkillMarkdown('gamma')
      expect(doc?.name).toBe('Gamma')
      expect(doc?.body).toContain('Only in bundle')
    } finally {
      process.env.BRAIN_USER_SKILLS_BUNDLE = emptyBundle
      await rm(bundle, { recursive: true, force: true })
    }
  })

  it('returns null when missing in both user and bundle', async () => {
    const { readSkillMarkdown } = await import('@server/lib/llm/slashSkill.js')
    const doc = await readSkillMarkdown('nonexistent-skill-xyz')
    expect(doc).toBeNull()
  })
})
