import { describe, it, expect } from 'vitest'
import { coerceToolResultDetailsObject } from './coerceToolResultDetails.js'

describe('coerceToolResultDetailsObject', () => {
  it('returns object details unchanged', () => {
    const o = { choices: [{ label: 'A', submit: 'b' }] }
    expect(coerceToolResultDetailsObject(o)).toBe(o)
  })

  it('parses JSON string object payload', () => {
    const s = JSON.stringify({ choices: [{ label: 'X', submit: 'y' }] })
    expect(coerceToolResultDetailsObject(s)).toEqual({
      choices: [{ label: 'X', submit: 'y' }],
    })
  })

  it('returns undefined for non-JSON or invalid', () => {
    expect(coerceToolResultDetailsObject('')).toBeUndefined()
    expect(coerceToolResultDetailsObject('not json')).toBeUndefined()
    expect(coerceToolResultDetailsObject(null)).toBeUndefined()
  })
})
