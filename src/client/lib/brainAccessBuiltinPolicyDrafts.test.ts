/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  clearBuiltinPolicyDraft,
  loadBuiltinPolicyDraft,
  saveBuiltinPolicyDraft,
} from './brainAccessBuiltinPolicyDrafts.js'

const KEY = 'brain.brainAccess.builtinPolicyDrafts.v1'

describe('brainAccessBuiltinPolicyDrafts', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY)
  })

  afterEach(() => {
    localStorage.removeItem(KEY)
  })

  it('saveBuiltinPolicyDraft round-trips via loadBuiltinPolicyDraft', () => {
    expect(loadBuiltinPolicyDraft('trusted')).toBeUndefined()
    saveBuiltinPolicyDraft('trusted', '  draft body  ')
    expect(loadBuiltinPolicyDraft('trusted')).toBe('draft body')
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ trusted: 'draft body' })
  })

  it('clearBuiltinPolicyDraft removes a key', () => {
    saveBuiltinPolicyDraft('trusted', 'x')
    clearBuiltinPolicyDraft('trusted')
    expect(loadBuiltinPolicyDraft('trusted')).toBeUndefined()
    expect(localStorage.getItem(KEY)).toBe('{}')
  })

  it('saveBuiltinPolicyDraft with empty trims to removal', () => {
    saveBuiltinPolicyDraft('trusted', 'keep')
    saveBuiltinPolicyDraft('trusted', '   ')
    expect(loadBuiltinPolicyDraft('trusted')).toBeUndefined()
  })
})
