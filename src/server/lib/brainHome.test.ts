import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let brainHome: string

beforeEach(async () => {
  brainHome = await mkdtemp(join(tmpdir(), 'brain-home-wipe-'))
  process.env.BRAIN_HOME = brainHome
})

afterEach(async () => {
  await rm(brainHome, { recursive: true, force: true })
  delete process.env.BRAIN_HOME
})

describe('wipeBrainHomeContents', () => {
  it('removes every top-level entry; keeps empty root', async () => {
    await mkdir(join(brainHome, 'wiki'), { recursive: true })
    await writeFile(join(brainHome, 'loose.txt'), 'x', 'utf-8')
    await mkdir(join(brainHome, 'extra'), { recursive: true })
    const { wipeBrainHomeContents } = await import('./brainHome.js')
    await wipeBrainHomeContents()
    expect(await readdir(brainHome)).toEqual([])
  })

  it('no-op when brain home does not exist', async () => {
    process.env.BRAIN_HOME = join(tmpdir(), `missing-brain-${Date.now()}`)
    const { wipeBrainHomeContents } = await import('./brainHome.js')
    await expect(wipeBrainHomeContents()).resolves.toBeUndefined()
  })
})
