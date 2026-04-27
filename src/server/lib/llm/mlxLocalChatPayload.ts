import type { Api, Model } from '@mariozechner/pi-ai'
import { MLX_LOCAL_PROVIDER } from './mlxLocalModel.js'

function mlxLocalThinkingEnabledFromEnv(): boolean {
  const v = process.env.MLX_LOCAL_THINKING?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * For `mlx-local`, force `chat_template_kwargs.enable_thinking` on every chat-completions
 * request so MLX LM does not use its default (thinking on).
 *
 * Default: thinking **off** (lower latency). Set `MLX_LOCAL_THINKING=1` to enable.
 */
export function patchMlxLocalChatTemplateThinking(
  params: unknown,
  model: Pick<Model<Api>, 'provider'>,
): Record<string, unknown> | undefined {
  if (model.provider !== MLX_LOCAL_PROVIDER) return undefined
  const p = params as Record<string, unknown>
  const existing =
    p.chat_template_kwargs && typeof p.chat_template_kwargs === 'object'
      ? (p.chat_template_kwargs as Record<string, unknown>)
      : {}
  return {
    ...p,
    chat_template_kwargs: { ...existing, enable_thinking: mlxLocalThinkingEnabledFromEnv() },
  }
}
