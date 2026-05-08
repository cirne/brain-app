import { completeSimple } from '@mariozechner/pi-ai'
import { brainLlmEnvDiagnosticLabel, getStandardBrainLlm, warnDeprecatedLlmEnvIfSet } from './effectiveBrainLlm.js'
import { resolveLlmApiKey, resolveModel } from './resolveModel.js'
import { chainLlmOnPayload } from './llmOnPayloadChain.js'

const SMOKE_TIMEOUT_MS = 60_000

function hasCredentials(apiKey: string | undefined): boolean {
  if (apiKey === undefined || apiKey === '') return false
  // pi-ai uses "<authenticated>" for Vertex ADC / Bedrock IAM-style auth
  return true
}

function llmEnvLabel(provider: string, modelId: string): string {
  return brainLlmEnvDiagnosticLabel(provider, modelId)
}

/**
 * Validates `BRAIN_LLM` (standard tier) and performs one minimal completion
 * against the configured provider. Throws on failure.
 */
export async function verifyLlmAtStartup(): Promise<void> {
  if (process.env.LLM_SKIP_STARTUP_SMOKE === 'true') {
    return
  }

  warnDeprecatedLlmEnvIfSet()
  const { provider, modelId } = getStandardBrainLlm()
  const model = resolveModel(provider, modelId)

  if (!model) {
    throw new Error(
      `[brain-app] LLM startup check failed: unknown provider/model: ${llmEnvLabel(provider, modelId)} (not in pi-ai registry or mlx-local catalog)`,
    )
  }

  const apiKey = resolveLlmApiKey(provider)
  if (!hasCredentials(apiKey)) {
    throw new Error(
      `[brain-app] LLM startup check failed: no API credentials for ${llmEnvLabel(provider, modelId)} (see pi-ai env conventions for this provider)`,
    )
  }

  const context = {
    messages: [
      {
        role: 'user' as const,
        content: 'Reply with the single word: ok',
        timestamp: Date.now(),
      },
    ],
  }

  try {
    const msg = await completeSimple(model, context, {
      apiKey,
      maxTokens: 16,
      // Omit temperature: some models (e.g. OpenAI gpt-5) reject the parameter entirely.
      signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
      // Same as Agent `onPayload`: pi-ai maps "thinking off" to reasoning.effort "none",
      // which gpt-5-codex rejects (requires low/medium/high).
      onPayload: (params, m) => chainLlmOnPayload(params, m),
    })

    if (msg.stopReason === 'error' || msg.errorMessage) {
      throw new Error(
        `[brain-app] LLM startup check failed: ${msg.errorMessage ?? msg.stopReason} (${llmEnvLabel(provider, modelId)})`,
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('[brain-app] LLM startup check failed:')) {
      throw e
    }
    throw new Error(
      `[brain-app] LLM startup check failed: ${e instanceof Error ? e.message : String(e)} (${llmEnvLabel(provider, modelId)})`,
      { cause: e },
    )
  }
}
