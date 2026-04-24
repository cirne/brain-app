import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ripmailProcessEnv } from './brainHome.js'

const keys = ['RIPMAIL_LLM_PROVIDER', 'LLM_PROVIDER'] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const k of keys) {
    saved[k] = process.env[k]
  }
  delete process.env.RIPMAIL_LLM_PROVIDER
  delete process.env.LLM_PROVIDER
})

afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]!
  }
})

describe('ripmailProcessEnv', () => {
  it('sets RIPMAIL_LLM_PROVIDER to openai when LLM_PROVIDER and RIPMAIL_LLM_PROVIDER are unset', () => {
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('openai')
  })

  it('sets RIPMAIL_LLM_PROVIDER from LLM_PROVIDER (lowercased) when RIPMAIL_LLM_PROVIDER is unset', () => {
    process.env.LLM_PROVIDER = 'openai'
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('openai')
  })

  it('trims and lowercases LLM_PROVIDER', () => {
    process.env.LLM_PROVIDER = '  OpenAI  '
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('openai')
  })

  it('does not override a non-empty RIPMAIL_LLM_PROVIDER', () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.RIPMAIL_LLM_PROVIDER = 'ollama'
    const env = ripmailProcessEnv()
    expect(env.RIPMAIL_LLM_PROVIDER).toBe('ollama')
  })
})
