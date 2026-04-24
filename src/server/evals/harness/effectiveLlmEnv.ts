/**
 * Effective LLM env for eval reports and filenames.
 * When unset, must match defaults in `assistantAgent` / `agentFactory` (`LLM_PROVIDER` / `LLM_MODEL`).
 */
export const EVAL_DEFAULT_LLM_PROVIDER = 'openai'
export const EVAL_DEFAULT_LLM_MODEL = 'gpt-5.4-mini'

export function getEffectiveLlmProviderForEval(): string {
  const p = process.env.LLM_PROVIDER?.trim()
  if (p) return p
  return EVAL_DEFAULT_LLM_PROVIDER
}

export function getEffectiveLlmModelForEval(): string {
  const m = process.env.LLM_MODEL?.trim()
  if (m) return m
  return EVAL_DEFAULT_LLM_MODEL
}

/**
 * Single path segment for report basenames (model id may contain `/`, `:`, etc. from gateways).
 */
export function sanitizeLlmModelIdForFilename(modelId: string): string {
  const s = modelId
    .replace(/[/\\:]/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return s || 'model'
}
