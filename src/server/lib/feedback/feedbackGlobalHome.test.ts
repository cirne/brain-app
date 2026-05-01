import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureCanonicalFeedbackLayoutForSubmit,
  getGlobalFeedbackBrainHome,
} from './feedbackGlobalHome.js'
import { brainLayoutIssuesDir, brainLayoutVarDir } from '@server/lib/platform/brainLayout.js'

describe('feedbackGlobalHome', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
  })

  it('getGlobalFeedbackBrainHome uses .global under BRAIN_DATA_ROOT', async () => {
    const base = await import('node:fs/promises').then((m) => m.mkdtemp(join(tmpdir(), 'gl-fb-test-')))
    process.env.BRAIN_DATA_ROOT = base
    expect(getGlobalFeedbackBrainHome()).toBe(join(base, '.global'))
    await ensureCanonicalFeedbackLayoutForSubmit()
    expect(existsSync(brainLayoutIssuesDir(join(base, '.global')))).toBe(true)
    expect(existsSync(brainLayoutVarDir(join(base, '.global')))).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })
})
