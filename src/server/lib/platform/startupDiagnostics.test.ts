import { describe, it } from 'vitest'
import { logStartupDiagnostics } from './startupDiagnostics.js'

describe('logStartupDiagnostics', () => {
  it(
    'completes without throwing',
    async () => {
      await logStartupDiagnostics()
    },
    // Startup diagnostics may touch filesystem / env checks — keep generous timeout for CI load spikes.
    15_000,
  )
})
