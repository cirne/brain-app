import { describe, it, expect } from 'vitest'
import { unifiedDiffChangedLinesOnly } from './editDiffDisplay.js'

describe('unifiedDiffChangedLinesOnly', () => {
  it('keeps only +/- lines', () => {
    const u = [
      '===================================================================',
      '--- a/foo.md',
      '+++ b/foo.md',
      '@@ -1,3 +1,3 @@',
      ' context',
      '-old',
      '+new',
      ' more context',
    ].join('\n')
    expect(unifiedDiffChangedLinesOnly(u)).toEqual(['-old', '+new'])
  })

  it('returns empty when no changed lines', () => {
    expect(unifiedDiffChangedLinesOnly('--- a\n+++ b\n@@ @@\n')).toEqual([])
  })
})
