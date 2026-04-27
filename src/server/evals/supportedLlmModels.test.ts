import { describe, expect, it } from 'vitest'
import { resolveModel } from '@server/lib/llm/resolveModel.js'
import {
  getDefaultLlmModelForProvider,
  getSupportedLlmForProvider,
  getSupportedLlmRegistry,
  isSupportedLlmModelInRegistry,
} from './supportedLlmModels.js'

describe('supported-llm-models.json', () => {
  it('has providers with defaults and at least one candidate each', () => {
    const reg = getSupportedLlmRegistry()
    expect(reg.version).toBe(2)
    for (const [name, entry] of Object.entries(reg.providers)) {
      expect(entry.default.trim(), `empty default: ${name}`).not.toBe('')
      expect(entry.candidates.length, `no candidates: ${name}`).toBeGreaterThan(0)
      const ids = new Set<string>()
      for (const c of entry.candidates) {
        expect(c.id.trim(), `empty id under ${name}`).not.toBe('')
        expect(ids.has(c.id), `duplicate id ${c.id} under ${name}`).toBe(false)
        ids.add(c.id)
      }
      expect(ids.has(entry.default), `default not in candidates for ${name}`).toBe(true)
    }
  })

  it('resolves every (provider, id) with resolveModel (pi-ai + Brain-only providers)', () => {
    const reg = getSupportedLlmRegistry()
    for (const [p, entry] of Object.entries(reg.providers)) {
      for (const id of [entry.default, ...entry.candidates.map((c) => c.id)]) {
        const m = resolveModel(p, id)
        expect(m, `resolveModel(${p}, ${id})`).toBeDefined()
      }
    }
  })

  it('costPerMillionTokens in JSON matches resolved model when present', () => {
    const reg = getSupportedLlmRegistry()
    for (const [p, entry] of Object.entries(reg.providers)) {
      for (const c of entry.candidates) {
        if (!c.costPerMillionTokens) continue
        const m = resolveModel(p, c.id)
        expect(m, `resolveModel(${p}, ${c.id})`).toBeDefined()
        expect(c.costPerMillionTokens).toEqual(m!.cost)
      }
    }
  })

  it('helper matches registry contents', () => {
    const entry = getSupportedLlmForProvider('anthropic')
    expect(entry).toBeDefined()
    const def = getDefaultLlmModelForProvider('anthropic')
    expect(def).toBe(entry!.default)
    expect(isSupportedLlmModelInRegistry('anthropic', def!)).toBe(true)
    expect(isSupportedLlmModelInRegistry('anthropic', 'nope-nope-nope')).toBe(false)
  })
})
