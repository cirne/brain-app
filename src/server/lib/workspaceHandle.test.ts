import { describe, expect, it } from 'vitest'
import {
  InvalidWorkspaceHandleError,
  normalizeWorkspaceHandle,
  parseWorkspaceHandle,
  WORKSPACE_HANDLE_MAX_LEN,
} from './workspaceHandle.js'

describe('workspaceHandle', () => {
  it('normalizes case and trim', () => {
    expect(normalizeWorkspaceHandle('  Lewis  ')).toBe('lewis')
  })

  it('parses valid handles', () => {
    expect(parseWorkspaceHandle('lewiscirne')).toBe('lewiscirne')
    expect(parseWorkspaceHandle('ab-c')).toBe('ab-c')
    expect(parseWorkspaceHandle('abc')).toBe('abc')
  })

  it('rejects too short or too long', () => {
    expect(() => parseWorkspaceHandle('ab')).toThrow(InvalidWorkspaceHandleError)
    expect(() => parseWorkspaceHandle('a')).toThrow(InvalidWorkspaceHandleError)
    expect(() => parseWorkspaceHandle('x'.repeat(WORKSPACE_HANDLE_MAX_LEN + 1))).toThrow(
      InvalidWorkspaceHandleError,
    )
  })

  it('rejects invalid characters and edges', () => {
    expect(() => parseWorkspaceHandle('no_underscore')).toThrow(InvalidWorkspaceHandleError)
    expect(() => parseWorkspaceHandle('-bad')).toThrow(InvalidWorkspaceHandleError)
    expect(() => parseWorkspaceHandle('bad-')).toThrow(InvalidWorkspaceHandleError)
    expect(() => parseWorkspaceHandle('')).toThrow(InvalidWorkspaceHandleError)
    expect(() => parseWorkspaceHandle('.global')).toThrow(InvalidWorkspaceHandleError)
  })

  it('rejects reserved names', () => {
    expect(() => parseWorkspaceHandle('_single')).toThrow(InvalidWorkspaceHandleError)
  })

  it('rejects non-string', () => {
    expect(() => parseWorkspaceHandle(null)).toThrow(InvalidWorkspaceHandleError)
  })
})
