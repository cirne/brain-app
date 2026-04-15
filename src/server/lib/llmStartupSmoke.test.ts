import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@mariozechner/pi-ai', () => ({
  getModel: vi.fn(),
  getEnvApiKey: vi.fn(),
  completeSimple: vi.fn(),
}))

import { completeSimple, getEnvApiKey, getModel } from '@mariozechner/pi-ai'
import { verifyLlmAtStartup } from './llmStartupSmoke.js'

const mockGetModel = vi.mocked(getModel)
const mockGetEnvApiKey = vi.mocked(getEnvApiKey)
const mockCompleteSimple = vi.mocked(completeSimple)

const fakeModel = {
  id: 'm',
  api: 'anthropic-messages' as const,
  provider: 'anthropic' as const,
}

describe('verifyLlmAtStartup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.LLM_SKIP_STARTUP_SMOKE
    delete process.env.LLM_PROVIDER
    delete process.env.LLM_MODEL
    mockGetModel.mockReturnValue(fakeModel as never)
    mockGetEnvApiKey.mockReturnValue('sk-test')
    mockCompleteSimple.mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'm',
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    })
  })

  it('skips network when LLM_SKIP_STARTUP_SMOKE=true', async () => {
    process.env.LLM_SKIP_STARTUP_SMOKE = 'true'
    await verifyLlmAtStartup()
    expect(mockGetModel).not.toHaveBeenCalled()
    expect(mockCompleteSimple).not.toHaveBeenCalled()
  })

  it('rejects when getModel returns undefined (unknown provider/model)', async () => {
    mockGetModel.mockReturnValue(undefined as never)
    await expect(verifyLlmAtStartup()).rejects.toThrow(/unknown provider\/model/)
    expect(mockCompleteSimple).not.toHaveBeenCalled()
  })

  it('rejects when no API credentials for provider', async () => {
    mockGetEnvApiKey.mockReturnValue(undefined)
    await expect(verifyLlmAtStartup()).rejects.toThrow(
      /no API credentials for LLM_PROVIDER=anthropic LLM_MODEL=claude-sonnet-4-20250514/,
    )
    expect(mockCompleteSimple).not.toHaveBeenCalled()
  })

  it('rejects when completeSimple throws', async () => {
    mockCompleteSimple.mockRejectedValue(new Error('401'))
    await expect(verifyLlmAtStartup()).rejects.toThrow(
      /LLM startup check failed: 401 \(LLM_PROVIDER=anthropic LLM_MODEL=claude-sonnet-4-20250514\)/,
    )
  })

  it('rejects when completion returns stopReason error', async () => {
    mockCompleteSimple.mockResolvedValue({
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'm',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'error',
      errorMessage: 'rate limit',
      timestamp: Date.now(),
    })
    await expect(verifyLlmAtStartup()).rejects.toThrow(
      /rate limit \(LLM_PROVIDER=anthropic LLM_MODEL=claude-sonnet-4-20250514\)/,
    )
  })

  it('resolves when smoke completion succeeds', async () => {
    await expect(verifyLlmAtStartup()).resolves.toBeUndefined()
    expect(mockCompleteSimple).toHaveBeenCalledTimes(1)
    const opts = mockCompleteSimple.mock.calls[0]?.[2]
    expect(opts).toEqual(
      expect.objectContaining({
        onPayload: expect.any(Function),
      }),
    )
  })
})
