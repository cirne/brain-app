import { describe, expect, it, afterEach } from 'vitest'
import { hasAnyLlmKey } from './llmPreflight.js'

const keys = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'XAI_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'VERCEL_AI_API_KEY',
  'VERCEL_OIDC_API_KEY',
  'MISTRAL_API_KEY',
  'OLLAMA_BASE_URL',
  'EVAL_FORCE_RUN',
] as const

describe('hasAnyLlmKey', () => {
  const snapshot: Record<string, string | undefined> = {}
  afterEach(() => {
    for (const k of keys) {
      const v = snapshot[k]
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    Object.keys(snapshot).forEach(k => delete snapshot[k])
  })

  it('is false when no known key is set', () => {
    for (const k of keys) {
      snapshot[k] = process.env[k]
      delete process.env[k]
    }
    expect(hasAnyLlmKey()).toBe(false)
  })

  it('is true when GEMINI_API_KEY is set (Gemini / provider google)', () => {
    for (const k of keys) {
      snapshot[k] = process.env[k]
      delete process.env[k]
    }
    process.env.GEMINI_API_KEY = 'x'
    expect(hasAnyLlmKey()).toBe(true)
  })
})
