/**
 * Shared guard for Enron / wiki JSONL eval CLIs: require a provider or local LLM, or EVAL_FORCE_RUN=1.
 */
export function hasAnyLlmKey(): boolean {
  return (
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.OPENAI_API_KEY) ||
    /** `@mariozechner/pi-ai` `google` provider (Gemini) */
    Boolean(process.env.GEMINI_API_KEY) ||
    Boolean(process.env.GOOGLE_API_KEY) ||
    Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY) ||
    Boolean(process.env.XAI_API_KEY) ||
    Boolean(process.env.GROQ_API_KEY) ||
    Boolean(process.env.OPENROUTER_API_KEY) ||
    Boolean(process.env.VERCEL_AI_API_KEY) ||
    Boolean(process.env.VERCEL_OIDC_API_KEY) ||
    Boolean(process.env.MISTRAL_API_KEY) ||
    Boolean(process.env.OLLAMA_BASE_URL) ||
    Boolean(process.env.EVAL_FORCE_RUN)
  )
}

/**
 * @param cap typically task count; result is in [1, cap]
 */
export function parseEvalMaxConcurrency(envVal: string | undefined, defaultValue: number, cap: number): number {
  const d = Math.max(1, Math.min(cap, defaultValue))
  if (envVal === undefined || envVal.trim() === '') {
    return d
  }
  const n = parseInt(envVal, 10)
  if (Number.isNaN(n) || n < 1) {
    return d
  }
  return Math.max(1, Math.min(cap, n))
}
