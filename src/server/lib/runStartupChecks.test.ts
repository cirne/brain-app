import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./llmStartupSmoke.js', () => ({
  verifyLlmAtStartup: vi.fn(),
}))
vi.mock('./startupDiagnostics.js', () => ({
  logStartupDiagnostics: vi.fn(),
}))

import { verifyLlmAtStartup } from './llmStartupSmoke.js'
import { logStartupDiagnostics } from './startupDiagnostics.js'
import { runStartupChecks } from './runStartupChecks.js'

describe('runStartupChecks', () => {
  beforeEach(() => {
    vi.mocked(logStartupDiagnostics).mockResolvedValue(undefined)
    vi.mocked(verifyLlmAtStartup).mockResolvedValue(undefined)
  })

  it('runs diagnostics then LLM verify', async () => {
    await runStartupChecks()
    const diagOrder = vi.mocked(logStartupDiagnostics).mock.invocationCallOrder[0] ?? 0
    const llmOrder = vi.mocked(verifyLlmAtStartup).mock.invocationCallOrder[0] ?? 0
    expect(diagOrder).toBeLessThan(llmOrder)
  })

  it('does not throw when LLM verify fails', async () => {
    vi.mocked(verifyLlmAtStartup).mockRejectedValue(new Error('no API credentials'))
    await expect(runStartupChecks()).resolves.toBeUndefined()
    expect(logStartupDiagnostics).toHaveBeenCalled()
    expect(verifyLlmAtStartup).toHaveBeenCalled()
  })
})
