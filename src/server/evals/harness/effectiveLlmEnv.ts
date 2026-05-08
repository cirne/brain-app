import { DEFAULT_BRAIN_LLM_STRING, getStandardBrainLlm } from '@server/lib/llm/effectiveBrainLlm.js'

/**
 * Default when `BRAIN_LLM` is unset; must match {@link DEFAULT_BRAIN_LLM_STRING}.
 */
export const EVAL_DEFAULT_BRAIN_LLM = DEFAULT_BRAIN_LLM_STRING

/** @deprecated Use {@link EVAL_DEFAULT_BRAIN_LLM} */
export const EVAL_DEFAULT_LLM_PROVIDER = 'openai'

/** @deprecated Use {@link EVAL_DEFAULT_BRAIN_LLM} */
export const EVAL_DEFAULT_LLM_MODEL = 'gpt-5.4-mini'

export function getEffectiveLlmProviderForEval(): string {
  return getStandardBrainLlm().provider
}

export function getEffectiveLlmModelForEval(): string {
  return getStandardBrainLlm().modelId
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
