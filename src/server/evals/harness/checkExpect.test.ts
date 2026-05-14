import { describe, expect, it } from 'vitest'
import { checkExpect } from './checkExpect.js'

describe('checkExpect', () => {
  it('supports finalTextExcludes privacy assertions', async () => {
    expect(
      (
        await checkExpect(
          { kind: 'finalTextExcludes', substring: 'JavaMail.evans@thyme', caseInsensitive: true },
          'A safe summary without raw ids.',
          '',
        )
      ).ok,
    ).toBe(true)

    const failed = await checkExpect(
      { kind: 'finalTextExcludesAll', substrings: ['$', 'JavaMail.evans@thyme'] },
      'The draft leaked JavaMail.evans@thyme.',
      '',
    )
    expect(failed.ok).toBe(false)
    expect(failed.reasons[0]).toContain('forbidden substring')
  })
})
