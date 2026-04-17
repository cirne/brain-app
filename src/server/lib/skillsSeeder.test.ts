import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { listBundledSkills, ensureDefaultSkillsSeeded } from './skillsSeeder.js'
import { bundledUserSkillsDir } from './bundledUserSkillsDir.js'

let brainHome: string
let bundleDir: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'skills-seed-'))
  bundleDir = await mkdtemp(join(tmpdir(), 'skills-bundle-'))
  await mkdir(join(bundleDir, 'alpha'), { recursive: true })
  await writeFile(
    join(bundleDir, 'alpha', 'SKILL.md'),
    `---
name: alpha
version: 2
---
Hello skill.`,
    'utf-8',
  )
  process.env.BRAIN_HOME = brainHome
  process.env.BRAIN_USER_SKILLS_BUNDLE = bundleDir
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  await rm(bundleDir, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
  delete process.env.BRAIN_USER_SKILLS_BUNDLE
})

describe('listBundledSkills', () => {
  it('reads slug and version from frontmatter', async () => {
    const list = await listBundledSkills(bundleDir)
    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe('alpha')
    expect(list[0].version).toBe('2')
  })

  it('repo bundled user-skills includes files skill', async () => {
    const savedBundle = process.env.BRAIN_USER_SKILLS_BUNDLE
    delete process.env.BRAIN_USER_SKILLS_BUNDLE
    try {
      const root = bundledUserSkillsDir()
      if (!root) return
      const list = await listBundledSkills(root)
      const slugs = list.map((m) => m.slug)
      expect(slugs).toContain('files')
      expect(slugs).toContain('email')
      expect(slugs).toContain('wiki')
    } finally {
      if (savedBundle !== undefined) process.env.BRAIN_USER_SKILLS_BUNDLE = savedBundle
      else delete process.env.BRAIN_USER_SKILLS_BUNDLE
    }
  })
})

describe('ensureDefaultSkillsSeeded', () => {
  it('copies bundled skill when missing', async () => {
    await ensureDefaultSkillsSeeded()
    const skillMd = join(brainHome, 'skills', 'alpha', 'SKILL.md')
    expect(existsSync(skillMd)).toBe(true)
    const body = await readFile(skillMd, 'utf-8')
    expect(body).toContain('Hello skill.')
  })

  it('does not overwrite an existing skill dir', async () => {
    await mkdir(join(brainHome, 'skills', 'alpha'), { recursive: true })
    await writeFile(join(brainHome, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\nversion: 2\n---\nUser edit.', 'utf-8')
    await ensureDefaultSkillsSeeded()
    const body = await readFile(join(brainHome, 'skills', 'alpha', 'SKILL.md'), 'utf-8')
    expect(body).toContain('User edit.')
  })

  it('does not resurrect after delete when same version already seeded', async () => {
    await ensureDefaultSkillsSeeded()
    const skillDir = join(brainHome, 'skills', 'alpha')
    await rm(skillDir, { recursive: true, force: true })
    await ensureDefaultSkillsSeeded()
    expect(existsSync(skillDir)).toBe(false)
  })
})
