import type { Api, Model } from '@mariozechner/pi-ai'
import { patchMlxLocalChatTemplateThinking } from './mlxLocalChatPayload.js'
import {
  patchOpenAiReasoningNoneEffort,
  type OpenAiResponsesPayload,
  type ReasoningModelRef,
} from './openAiResponsesPayload.js'

type PayloadModel = ReasoningModelRef & Pick<Model<Api>, 'provider'>

function applyPayloadChain(params: unknown, model: PayloadModel): unknown | undefined {
  const p0 = params as OpenAiResponsesPayload
  const openai = patchOpenAiReasoningNoneEffort(p0, model)
  const base = (openai ?? p0) as Record<string, unknown>
  const mlx = patchMlxLocalChatTemplateThinking(base, model)
  if (mlx !== undefined) return mlx
  return openai
}

/**
 * Pre-request hooks for pi-ai: OpenAI Responses `reasoning.effort` workaround +
 * MLX local Qwen `chat_template_kwargs.enable_thinking`.
 */
export function chainLlmOnPayload(params: unknown, model: PayloadModel): unknown | undefined {
  return applyPayloadChain(params, model)
}

/**
 * Use with **`Agent` `thinkingLevel: "off"`** (main chat assistant). Same hooks as {@link chainLlmOnPayload};
 * keeping a separate export documents intent (`assistantAgent.ts`).
 */
export function chainLlmOnPayloadNoThinking(params: unknown, model: PayloadModel): unknown | undefined {
  return applyPayloadChain(params, model)
}
