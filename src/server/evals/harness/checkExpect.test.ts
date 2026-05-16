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

  it('supports toolResultExcludes on concatenated tool output', async () => {
    const ok = await checkExpect(
      { kind: 'toolResultExcludes', substring: 'To: team_macrum_eval_nope', caseInsensitive: true },
      '',
      'Draft id: abc\nTo: janet.butler@enron.com',
    )
    expect(ok.ok).toBe(true)

    const failed = await checkExpect(
      { kind: 'toolResultExcludes', substring: 'To: team_macrum_eval_nope', caseInsensitive: true },
      '',
      'To: team_macrum_eval_nope',
    )
    expect(failed.ok).toBe(false)
    expect(failed.reasons[0]).toContain('forbidden substring')
  })
})
