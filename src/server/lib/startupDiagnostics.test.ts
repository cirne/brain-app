import { describe, it } from 'vitest'
import { logStartupDiagnostics } from './startupDiagnostics.js'

describe('logStartupDiagnostics', () => {
  it(
    'completes without throwing',
    async () => {
      await logStartupDiagnostics()
    },
    // Ripmail `--version` + `status --json` can exceed the default 5s under load.
    15_000,
  )
})
