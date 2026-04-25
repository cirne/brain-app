import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { listBundledSkills } from './skillsSeeder.js'
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
      expect(slugs).toContain('briefing')
      expect(slugs).toContain('files')
      expect(slugs).toContain('email')
      expect(slugs).toContain('inbox_triage')
      expect(slugs).toContain('morning_report')
      expect(slugs).toContain('trip_sheet')
      expect(slugs).toContain('wiki')
    } finally {
      if (savedBundle !== undefined) process.env.BRAIN_USER_SKILLS_BUNDLE = savedBundle
      else delete process.env.BRAIN_USER_SKILLS_BUNDLE
    }
  })
})

