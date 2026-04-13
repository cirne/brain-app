import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type KnownProvider,
} from '@mariozechner/pi-ai'

const DEFAULT_PROVIDER = 'anthropic' as KnownProvider
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const SMOKE_TIMEOUT_MS = 60_000

function hasCredentials(apiKey: string | undefined): boolean {
  if (apiKey === undefined || apiKey === '') return false
  // pi-ai uses "<authenticated>" for Vertex ADC / Bedrock IAM-style auth
  return true
}

/**
 * Validates LLM_PROVIDER / LLM_MODEL and performs one minimal completion
 * against the configured provider. Throws on failure.
 */
export async function verifyLlmAtStartup(): Promise<void> {
  if (process.env.LLM_SKIP_STARTUP_SMOKE === 'true') {
    return
  }

  const provider = (process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER) as KnownProvider
  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODEL
  const model = getModel(provider, modelId as never)

  if (!model) {
    throw new Error(
      `[brain-app] LLM startup check failed: unknown provider/model: LLM_PROVIDER=${provider} LLM_MODEL=${modelId} (not in pi-ai registry)`,
    )
  }

  const apiKey = getEnvApiKey(provider)
  if (!hasCredentials(apiKey)) {
    throw new Error(
      `[brain-app] LLM startup check failed: no API credentials for provider "${provider}" (see pi-ai env conventions for this provider)`,
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
      temperature: 0,
      signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
    })

    if (msg.stopReason === 'error' || msg.errorMessage) {
      throw new Error(
        `[brain-app] LLM startup check failed: ${msg.errorMessage ?? msg.stopReason}`,
      )
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('[brain-app] LLM startup check failed:')) {
      throw e
    }
    throw new Error(
      `[brain-app] LLM startup check failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }
}
