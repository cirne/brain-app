import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isMultiTenantMode } from './dataRoot.js'
import {
  ensureCanonicalFeedbackLayoutForSubmit,
  getGlobalFeedbackBrainHome,
} from './feedbackGlobalHome.js'
import { brainLayoutIssuesDir, brainLayoutVarDir } from './brainLayout.js'

describe('feedbackGlobalHome', () => {
  const prevRoot = process.env.BRAIN_DATA_ROOT
  const prevHome = process.env.BRAIN_HOME

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.BRAIN_DATA_ROOT
    else process.env.BRAIN_DATA_ROOT = prevRoot
    if (prevHome === undefined) delete process.env.BRAIN_HOME
    else process.env.BRAIN_HOME = prevHome
  })

  it('getGlobalFeedbackBrainHome uses .global in multi-tenant mode', async () => {
    const base = await import('node:fs/promises').then(m =>
      m.mkdtemp(join(tmpdir(), 'gl-fb-test-')),
    )
    process.env.BRAIN_DATA_ROOT = base
    delete process.env.BRAIN_HOME
    expect(isMultiTenantMode()).toBe(true)
    expect(getGlobalFeedbackBrainHome()).toBe(join(base, '.global'))
    await ensureCanonicalFeedbackLayoutForSubmit()
    expect(existsSync(brainLayoutIssuesDir(join(base, '.global')))).toBe(true)
    expect(existsSync(brainLayoutVarDir(join(base, '.global')))).toBe(true)
    rmSync(base, { recursive: true, force: true })
  })

  it('getGlobalFeedbackBrainHome == BRAIN_HOME in single-tenant', () => {
    const h = join(tmpdir(), 'st-fb-gh')
    mkdirSync(h, { recursive: true })
    delete process.env.BRAIN_DATA_ROOT
    process.env.BRAIN_HOME = h
    expect(isMultiTenantMode()).toBe(false)
    expect(getGlobalFeedbackBrainHome()).toBe(h)
    rmSync(h, { recursive: true, force: true })
  })
})
