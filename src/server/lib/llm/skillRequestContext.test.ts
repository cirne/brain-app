import { describe, it, expect } from 'vitest'
import {
  runWithSkillRequestContext,
  tryGetSkillRequestContext,
} from './skillRequestContext.js'

describe('skillRequestContext', () => {
  it('tryGetSkillRequestContext returns undefined outside run', () => {
    expect(tryGetSkillRequestContext()).toBeUndefined()
  })

  it('runWithSkillRequestContext exposes context to inner sync code', () => {
    runWithSkillRequestContext({ selection: 'x', openFile: 'a.md' }, () => {
      expect(tryGetSkillRequestContext()).toEqual({ selection: 'x', openFile: 'a.md' })
    })
    expect(tryGetSkillRequestContext()).toBeUndefined()
  })
})
