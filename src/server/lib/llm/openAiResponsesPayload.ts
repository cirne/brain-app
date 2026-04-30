import { openAiResponsesModelRejectsReasoningEffortNone } from './supportedModels/openaiResponsesThinking.js'

/**
 * OpenAI Responses API params built by pi-ai before `client.responses.create`.
 * Only fields we adjust are typed; the rest pass through.
 */
export type OpenAiResponsesPayload = Record<string, unknown> & {
  reasoning?: { effort?: string; summary?: string }
  include?: string[]
}

export type ReasoningModelRef = {
  id: string
  reasoning?: boolean
}

/**
 * pi-ai maps `thinkingLevel: "off"` → `reasoning.effort: "none"` for Responses.
 * Known-reject ids (see [`openaiResponsesThinking.ts`](./supportedModels/openaiResponsesThinking.ts))
 * still require at least `"low"` or the API fails.
 */
export function patchOpenAiReasoningNoneEffort(
  params: OpenAiResponsesPayload,
  model: ReasoningModelRef,
): OpenAiResponsesPayload | undefined {
  if (!model.reasoning) return undefined
  if (!openAiResponsesModelRejectsReasoningEffortNone(model.id)) return undefined
  if (params.reasoning?.effort !== 'none') return undefined
  const summary = params.reasoning.summary ?? 'auto'
  const include = new Set(params.include ?? [])
  include.add('reasoning.encrypted_content')
  return {
    ...params,
    reasoning: { effort: 'low', summary },
    include: [...include],
  }
}
