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
 * pi-ai sets `reasoning.effort` to `"none"` when agent thinking is off. Some
 * models (e.g. gpt-5-codex) reject that and require low/medium/high.
 */
export function patchOpenAiReasoningNoneEffort(
  params: OpenAiResponsesPayload,
  model: ReasoningModelRef,
): OpenAiResponsesPayload | undefined {
  if (!model.reasoning) return undefined
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
