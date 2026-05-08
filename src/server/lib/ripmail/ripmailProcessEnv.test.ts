import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ripmailProcessEnv } from '@server/lib/platform/brainHome.js'

const keys = ['RIPMAIL_LLM_PROVIDER', 'BRAIN_LLM', 'LLM_PROVIDER'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of keys) {
    saved[k] = process.env[k]
  }
  delete process.env.RIPMAIL_LLM_PROVIDER
  delete process.env.BRAIN_LLM
  delete process.env.LLM_PROVIDER
})

afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]!
  }
})

describe('ripmailProcessEnv', () => {
  it('sets RIPMAIL_LLM_PROVIDER to openai when BRAIN_LLM and RIPMAIL_LLM_PROVIDER are unset', () => {
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('openai')
  })

  it('sets RIPMAIL_LLM_PROVIDER from BRAIN_LLM provider (lowercased) when RIPMAIL_LLM_PROVIDER is unset', () => {
    process.env.BRAIN_LLM = 'xai/grok-4-1-fast'
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('xai')
  })

  it('sets RIPMAIL_LLM_PROVIDER from BRAIN_LLM shorthand (e.g. haiku → anthropic)', () => {
    process.env.BRAIN_LLM = 'haiku'
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('anthropic')
  })

  it('does not read deprecated LLM_PROVIDER when BRAIN_LLM is unset', () => {
    process.env.LLM_PROVIDER = 'anthropic'
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('openai')
  })

  it('does not override a non-empty RIPMAIL_LLM_PROVIDER', () => {
    process.env.BRAIN_LLM = 'openai/gpt-5.4'
    process.env.RIPMAIL_LLM_PROVIDER = 'ollama'
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('ollama')
  })
})
