import { describe, it, expect } from 'vitest'
import { formatExecError } from './execError.js'

describe('formatExecError', () => {
  it('prefers stderr/stdout from exec errors', () => {
    const err = Object.assign(new Error('Command failed: git pull'), {
      stderr: 'fatal: not a repository',
      stdout: '',
    })
    expect(formatExecError(err)).toContain('fatal: not a repository')
  })

  it('falls back to message string', () => {
    expect(formatExecError(new Error('oops'))).toBe('oops')
  })
})
