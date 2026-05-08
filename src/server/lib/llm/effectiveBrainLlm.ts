import { getSupportedLlmRegistry, type SupportedLlmRegistry } from '@server/evals/supportedLlmModels.js'

/** Hard-coded default when `BRAIN_LLM` is unset (matches prior `openai` + `gpt-5.4-mini`). */
export const DEFAULT_BRAIN_LLM_STRING = 'openai/gpt-5.4-mini'

export type BrainLlmPair = { provider: string; modelId: string }

export class BrainLlmParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrainLlmParseError'
  }
}

const NICKNAME_TO_PAIR: Record<string, BrainLlmPair> = {
  // Anthropic (aligned with supported-llm-models.json)
  sonnet: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  'claude-sonnet': { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  haiku: { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  'claude-haiku': { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  opus: { provider: 'anthropic', modelId: 'claude-opus-4-6' },
  'claude-opus': { provider: 'anthropic', modelId: 'claude-opus-4-6' },
  // OpenAI
  'gpt-5.4-mini': { provider: 'openai', modelId: 'gpt-5.4-mini' },
  'gpt-5.4': { provider: 'openai', modelId: 'gpt-5.4' },
  'gpt-5.4-nano': { provider: 'openai', modelId: 'gpt-5.4-nano' },
  // xAI
  grok: { provider: 'xai', modelId: 'grok-4-1-fast' },
  'grok-fast': { provider: 'xai', modelId: 'grok-4-1-fast' },
}

let canonicalIndex:
  | {
      /** model id (exact casing from registry) → providers that declare it */
      idToProviders: Map<string, string[]>
      /** lowercase id → official id string from registry */
      lowerToOfficialId: Map<string, string>
    }
  | undefined

function buildCanonicalIndex(reg: SupportedLlmRegistry) {
  const idToProviders = new Map<string, string[]>()
  const lowerToOfficialId = new Map<string, string>()

  for (const [providerKey, entry] of Object.entries(reg.providers)) {
    const ids = new Set<string>()
    ids.add(entry.default)
    for (const c of entry.candidates) ids.add(c.id)
    for (const id of ids) {
      lowerToOfficialId.set(id.toLowerCase(), id)
      const list = idToProviders.get(id) ?? []
      if (!list.includes(providerKey)) list.push(providerKey)
      idToProviders.set(id, list)
    }
  }

  return { idToProviders, lowerToOfficialId }
}

function getCanonicalIndex() {
  if (!canonicalIndex) {
    canonicalIndex = buildCanonicalIndex(getSupportedLlmRegistry())
  }
  return canonicalIndex
}

/** Clears cached registry index (for Vitest when mocking `getSupportedLlmRegistry`). */
export function resetBrainLlmCanonicalCacheForTest(): void {
  canonicalIndex = undefined
}

function resolveBareCanonicalToken(token: string): BrainLlmPair {
  const { idToProviders, lowerToOfficialId } = getCanonicalIndex()
  const official = lowerToOfficialId.get(token) ?? lowerToOfficialId.get(token.toLowerCase())
  if (!official) {
    const nick = Object.keys(NICKNAME_TO_PAIR).join(', ')
    throw new BrainLlmParseError(
      `[brain-app] Unknown BRAIN_LLM shorthand "${token}". Use provider/model (e.g. openai/gpt-5.4) or a supported nickname (${nick}), or a model id listed in supported-llm-models.json.`,
    )
  }
  const providers = idToProviders.get(official) ?? []
  if (providers.length !== 1) {
    throw new BrainLlmParseError(
      `[brain-app] Ambiguous model id "${token}" for BRAIN_LLM (used by: ${providers.join(', ')}). Set provider/model explicitly (e.g. openai/${official}).`,
    )
  }
  return { provider: providers[0]!, modelId: official }
}

/**
 * Parse a single `BRAIN_LLM` / `BRAIN_FAST_LLM` value: `provider/model` (first `/` only),
 * a curated nickname, or a bare model id from `supported-llm-models.json`.
 */
export function parseBrainLlmSpec(raw: string): BrainLlmPair {
  const s = raw.trim()
  if (!s) {
    throw new BrainLlmParseError(`[brain-app] BRAIN_LLM value is empty`)
  }
  const slash = s.indexOf('/')
  if (slash !== -1) {
    const provider = s.slice(0, slash).trim().toLowerCase()
    const modelId = s.slice(slash + 1).trim()
    if (!provider || !modelId) {
      throw new BrainLlmParseError(
        `[brain-app] Invalid BRAIN_LLM "${raw}": provider and model must be non-empty around "/"`,
      )
    }
    return { provider, modelId }
  }

  const key = s.toLowerCase()
  const nick = NICKNAME_TO_PAIR[key]
  if (nick) return { ...nick }

  return resolveBareCanonicalToken(s)
}

function standardRawFromEnv(): string {
  const v = process.env.BRAIN_LLM?.trim()
  return v && v.length > 0 ? v : DEFAULT_BRAIN_LLM_STRING
}

/** Standard tier: primary agent, eval, startup smoke, feedback composer, ripmail provider mapping, etc. */
export function getStandardBrainLlm(): BrainLlmPair {
  return parseBrainLlmSpec(standardRawFromEnv())
}

/** Fast tier: use `BRAIN_FAST_LLM` when set; otherwise same as {@link getStandardBrainLlm}. */
export function getFastBrainLlm(): BrainLlmPair {
  const v = process.env.BRAIN_FAST_LLM?.trim()
  if (v && v.length > 0) return parseBrainLlmSpec(v)
  return getStandardBrainLlm()
}

/** Best-effort standard tier for logging when messages lack model ids (invalid env → `null`). */
export function tryStandardBrainLlmForTelemetry(): BrainLlmPair | null {
  try {
    return getStandardBrainLlm()
  } catch {
    return null
  }
}

export function brainLlmEnvDiagnosticLabel(provider: string, modelId: string): string {
  return `BRAIN_LLM effective ${provider}/${modelId}`
}

let legacyWarned = false

/** Warn once if deprecated `LLM_PROVIDER` / `LLM_MODEL` are still set. */
export function warnDeprecatedLlmEnvIfSet(): void {
  if (legacyWarned) return
  const p = process.env.LLM_PROVIDER?.trim()
  const m = process.env.LLM_MODEL?.trim()
  if (p || m) {
    legacyWarned = true
    console.warn(
      '[brain-app] LLM_PROVIDER and LLM_MODEL are deprecated; use BRAIN_LLM (and optional BRAIN_FAST_LLM). Example: BRAIN_LLM=openai/gpt-5.4-mini',
    )
  }
}
