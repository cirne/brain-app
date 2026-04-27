import { afterEach, describe, expect, it } from 'vitest'
import { MLX_LOCAL_PROVIDER } from './mlxLocalModel.js'
import { resolveLlmApiKey, resolveModel } from './resolveModel.js'

describe('resolveModel', () => {
  afterEach(() => {
    delete process.env.MLX_LOCAL_BASE_URL
  })

  it('returns MLX Qwen model with default base URL', () => {
    const m = resolveModel(MLX_LOCAL_PROVIDER, 'mlx-community/Qwen3.6-27B-4bit')
    expect(m).toBeDefined()
    expect(m!.api).toBe('openai-completions')
    expect(m!.baseUrl).toBe('http://localhost:11444/v1')
    expect((m!.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat).toBe('qwen-chat-template')
  })

  it('respects MLX_LOCAL_BASE_URL', () => {
    process.env.MLX_LOCAL_BASE_URL = 'http://127.0.0.1:9999/v1'
    const m = resolveModel(MLX_LOCAL_PROVIDER, 'mlx-community/Qwen3.6-27B-8bit')
    expect(m?.baseUrl).toBe('http://127.0.0.1:9999/v1')
  })

  it('returns undefined for unknown mlx-local model id', () => {
    expect(resolveModel(MLX_LOCAL_PROVIDER, 'nope')).toBeUndefined()
  })
})

describe('resolveLlmApiKey', () => {
  afterEach(() => {
    delete process.env.MLX_LOCAL_API_KEY
  })

  it('defaults mlx-local key to local when unset', () => {
    expect(resolveLlmApiKey(MLX_LOCAL_PROVIDER)).toBe('local')
  })

  it('uses MLX_LOCAL_API_KEY when set', () => {
    process.env.MLX_LOCAL_API_KEY = 'custom'
    expect(resolveLlmApiKey(MLX_LOCAL_PROVIDER)).toBe('custom')
  })
})
