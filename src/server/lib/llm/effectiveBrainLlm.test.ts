import { afterEach, describe, expect, it, vi } from 'vitest'
import * as supportedLlmModels from '@server/evals/supportedLlmModels.js'
import type { SupportedLlmRegistry } from '@server/evals/supportedLlmModels.js'
import {
  parseBrainLlmSpec,
  getStandardBrainLlm,
  getFastBrainLlm,
  warnDeprecatedLlmEnvIfSet,
  DEFAULT_BRAIN_LLM_STRING,
  tryStandardBrainLlmForTelemetry,
  resetBrainLlmCanonicalCacheForTest,
} from './effectiveBrainLlm.js'

describe('parseBrainLlmSpec', () => {
  it('splits on first / only (mlx-local, openrouter)', () => {
    expect(parseBrainLlmSpec('mlx-local/mlx-community/Qwen3.6-27B-4bit')).toEqual({
      provider: 'mlx-local',
      modelId: 'mlx-community/Qwen3.6-27B-4bit',
    })
    expect(parseBrainLlmSpec('openrouter/openai/gpt-4')).toEqual({
      provider: 'openrouter',
      modelId: 'openai/gpt-4',
    })
  })

  it('parses explicit provider/model with normalized provider casing', () => {
    expect(parseBrainLlmSpec('  OpenAI/gpt-5.4  ')).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.4',
    })
    expect(parseBrainLlmSpec('google/gemini-3-flash-preview')).toEqual({
      provider: 'google',
      modelId: 'gemini-3-flash-preview',
    })
  })

  it('resolves nicknames (case-insensitive)', () => {
    expect(parseBrainLlmSpec('sonnet')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })
    expect(parseBrainLlmSpec('Haiku')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
    })
    expect(parseBrainLlmSpec('opus')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-opus-4-6',
    })
  })

  it('passes through canonical ids from supported-llm-models registry', () => {
    expect(parseBrainLlmSpec('gpt-5.4-mini')).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.4-mini',
    })
    expect(parseBrainLlmSpec('grok-4-1-fast')).toEqual({
      provider: 'xai',
      modelId: 'grok-4-1-fast',
    })
  })

  it('rejects empty segments after split', () => {
    expect(() => parseBrainLlmSpec('/gpt-5.4')).toThrow(/non-empty/)
    expect(() => parseBrainLlmSpec('openai/')).toThrow(/non-empty/)
  })

  it('rejects unknown bare tokens', () => {
    expect(() => parseBrainLlmSpec('totally-unknown-model-id-zzz')).toThrow(/unknown/)
  })

  it('rejects bare id when duplicate across providers in registry (use provider/model)', () => {
    vi.spyOn(supportedLlmModels, 'getSupportedLlmRegistry').mockReturnValue({
      version: 99,
      description: 'fixture duplicate id',
      providers: {
        openai: {
          default: 'duplicate-across-providers',
          candidates: [{ id: 'duplicate-across-providers', tested: false }],
        },
        anthropic: {
          default: 'duplicate-across-providers',
          candidates: [{ id: 'duplicate-across-providers', tested: false }],
        },
      },
    } as SupportedLlmRegistry)
    resetBrainLlmCanonicalCacheForTest()
    expect(() => parseBrainLlmSpec('duplicate-across-providers')).toThrow(/Ambiguous/)
    expect(parseBrainLlmSpec('openai/duplicate-across-providers')).toEqual({
      provider: 'openai',
      modelId: 'duplicate-across-providers',
    })
    vi.restoreAllMocks()
    resetBrainLlmCanonicalCacheForTest()
  })
})

describe('getStandardBrainLlm / getFastBrainLlm', () => {
  afterEach(() => {
    delete process.env.BRAIN_LLM
    delete process.env.BRAIN_FAST_LLM
  })

  it('defaults standard tier when BRAIN_LLM unset', () => {
    expect(getStandardBrainLlm()).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.4-mini',
    })
  })

  it('uses BRAIN_LLM when set', () => {
    process.env.BRAIN_LLM = 'anthropic/claude-sonnet-4-6'
    expect(getStandardBrainLlm()).toEqual({
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })
  })

  it('fast tier matches standard when BRAIN_FAST_LLM unset', () => {
    process.env.BRAIN_LLM = 'xai/grok-4-1-fast'
    expect(getFastBrainLlm()).toEqual(getStandardBrainLlm())
  })

  it('uses BRAIN_FAST_LLM when set', () => {
    process.env.BRAIN_LLM = 'openai/gpt-5.4'
    process.env.BRAIN_FAST_LLM = 'haiku'
    expect(getStandardBrainLlm()).toEqual({ provider: 'openai', modelId: 'gpt-5.4' })
    expect(getFastBrainLlm()).toEqual({
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
    })
  })

  it('exposes default string constant', () => {
    expect(DEFAULT_BRAIN_LLM_STRING).toBe('openai/gpt-5.4-mini')
  })
})

describe('tryStandardBrainLlmForTelemetry', () => {
  afterEach(() => {
    delete process.env.BRAIN_LLM
  })

  it('returns parsed pair when BRAIN_LLM is valid', () => {
    process.env.BRAIN_LLM = 'openai/gpt-5.4'
    expect(tryStandardBrainLlmForTelemetry()).toEqual({
      provider: 'openai',
      modelId: 'gpt-5.4',
    })
  })

  it('returns null when BRAIN_LLM is invalid', () => {
    process.env.BRAIN_LLM = 'not-a-real-model-zzz'
    expect(tryStandardBrainLlmForTelemetry()).toBeNull()
  })
})

describe('warnDeprecatedLlmEnvIfSet', () => {
  afterEach(() => {
    delete process.env.LLM_PROVIDER
    delete process.env.LLM_MODEL
  })

  it('logs when legacy env is set', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.LLM_MODEL = 'gpt-5'
    warnDeprecatedLlmEnvIfSet()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
