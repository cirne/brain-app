import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** USD per 1M tokens; mirrors `@earendil-works/pi-ai` `Model.cost` (used for eval COGS estimates). */
export type CostPerMillionTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type SupportedLlmModelEntry = {
  id: string
  /** When true, we treat this as a known-good baseline for local/CI eval sweeps. */
  tested: boolean
  label?: string
  costPerMillionTokens?: CostPerMillionTokens
}

export type SupportedLlmProviderEntry = {
  default: string
  candidates: SupportedLlmModelEntry[]
}

export type SupportedLlmRegistry = {
  version: number
  description: string
  pricing?: {
    currency?: string
    perMillionTokens?: string
    source?: string
    alignedWith?: string
    piAiVersion?: string
  }
  providers: Record<string, SupportedLlmProviderEntry>
}

const jsonPath = join(dirname(fileURLToPath(import.meta.url)), 'supported-llm-models.json')

let cached: SupportedLlmRegistry | undefined

/**
 * Load `supported-llm-models.json` (eval registry of provider → model ids).
 */
export function getSupportedLlmRegistry(): SupportedLlmRegistry {
  if (!cached) {
    cached = JSON.parse(readFileSync(jsonPath, 'utf-8')) as SupportedLlmRegistry
  }
  return cached
}

/**
 * @returns `undefined` if the provider is not in the JSON registry
 */
export function getSupportedLlmForProvider(
  provider: string,
): SupportedLlmProviderEntry | undefined {
  return getSupportedLlmRegistry().providers[provider]
}

/**
 * @returns the default model id for the given provider key in this registry, or `undefined` if the provider is missing (used by eval CLI `-p` without `-m`).
 */
export function getDefaultLlmModelForProvider(provider: string): string | undefined {
  return getSupportedLlmForProvider(provider)?.default
}

/**
 * Ids in the JSON for this provider, in file order.
 */
export function getSupportedLlmModelIdsForProvider(provider: string): string[] {
  return getSupportedLlmForProvider(provider)?.candidates.map((c) => c.id) ?? []
}

/**
 * True when (provider, modelId) appears in the JSON registry. Unknown providers return false.
 */
export function isSupportedLlmModelInRegistry(provider: string, modelId: string): boolean {
  const p = getSupportedLlmForProvider(provider)
  if (!p) return false
  if (p.default === modelId) return true
  return p.candidates.some((c) => c.id === modelId)
}

/** Provider keys present in the JSON (e.g. `anthropic`, `openai`). */
export function listRegisteredLlmProviderKeys(): string[] {
  return Object.keys(getSupportedLlmRegistry().providers)
}
