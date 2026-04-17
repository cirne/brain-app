import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { join } from 'node:path'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'skills-api-'))
  const skillsRoot = join(brainHome, 'skills')
  await mkdir(join(skillsRoot, 'demo'), { recursive: true })
  await writeFile(
    join(skillsRoot, 'demo', 'SKILL.md'),
    `---
name: demo
label: Demo skill
description: A test skill for GET /api/skills.
---
Body.`,
    'utf-8',
  )
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('GET /api/skills', () => {
  it('returns JSON list of skills', async () => {
    const { default: skillsRoute } = await import('./skills.js')
    const app = new Hono()
    app.route('/api/skills', skillsRoute)

    const res = await app.request('/api/skills')
    expect(res.status).toBe(200)
    const data = (await res.json()) as Array<{ name: string; label: string }>
    expect(Array.isArray(data)).toBe(true)
    expect(data.some(s => s.name === 'demo' && s.label === 'Demo skill')).toBe(true)
  })
})
