import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'
import { ensureBrainHomeGitignore } from './brainHomeGitignore.js'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'brain-gitignore-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('ensureBrainHomeGitignore', () => {
  it('writes .gitignore from template when missing', async () => {
    await ensureBrainHomeGitignore()
    const p = join(brainHome, '.gitignore')
    expect(existsSync(p)).toBe(true)
    const text = await readFile(p, 'utf-8')
    expect(text).toContain('cache/')
    expect(text).toContain('ripmail/**/*.db')
  })

  it('is idempotent when .gitignore already exists', async () => {
    await ensureBrainHomeGitignore()
    const first = await readFile(join(brainHome, '.gitignore'), 'utf-8')
    await ensureBrainHomeGitignore()
    const second = await readFile(join(brainHome, '.gitignore'), 'utf-8')
    expect(second).toBe(first)
  })

  it('does not overwrite user .gitignore', async () => {
    const custom = '# custom\n'
    await writeFile(join(brainHome, '.gitignore'), custom, 'utf-8')
    await ensureBrainHomeGitignore()
    const text = await readFile(join(brainHome, '.gitignore'), 'utf-8')
    expect(text).toBe(custom)
  })
})
