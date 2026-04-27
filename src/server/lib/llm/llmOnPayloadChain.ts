import type { Api, Model } from '@mariozechner/pi-ai'
import { patchMlxLocalChatTemplateThinking } from './mlxLocalChatPayload.js'
import {
  patchOpenAiReasoningNoneEffort,
  type OpenAiResponsesPayload,
  type ReasoningModelRef,
} from './openAiResponsesPayload.js'

type PayloadModel = ReasoningModelRef & Pick<Model<Api>, 'provider'>

/**
 * Pre-request hooks for pi-ai: OpenAI Responses `reasoning.effort` workaround +
 * MLX local Qwen `chat_template_kwargs.enable_thinking`.
 */
export function chainLlmOnPayload(params: unknown, model: PayloadModel): unknown | undefined {
  const p0 = params as OpenAiResponsesPayload
  const openai = patchOpenAiReasoningNoneEffort(p0, model)
  const base = (openai ?? p0) as Record<string, unknown>
  const mlx = patchMlxLocalChatTemplateThinking(base, model)
  if (mlx !== undefined) return mlx
  return openai
}
