import { describe, it } from 'vitest'
import { logStartupDiagnostics } from './startupDiagnostics.js'

describe('logStartupDiagnostics', () => {
  it('completes without throwing', async () => {
    await logStartupDiagnostics()
  })
})
