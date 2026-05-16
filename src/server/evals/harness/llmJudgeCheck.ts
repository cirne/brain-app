import { completeSimple, type UserMessage } from '@earendil-works/pi-ai'
import { chainLlmOnPayloadNoThinking } from '@server/lib/llm/llmOnPayloadChain.js'
import { parseBrainLlmSpec } from '@server/lib/llm/effectiveBrainLlm.js'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'

/** Default judge model when `BRAIN_EVAL_JUDGE_LLM` is unset (cheap tier). */
export const DEFAULT_EVAL_JUDGE_LLM = 'openai/gpt-5.4-nano'

const JUDGE_SYSTEM = `You score tunnel (brain-to-brain) answers using ONLY the rubric in the user message.
You are NOT given source mail or tool logs: if the rubric tells you not to fail for missing citations, unsupported specifics, or "grounding," you MUST obey that and still output JSON.
Reply with ONLY valid JSON (no markdown fences): {"pass":true|false,"reason":"one short sentence"}`

export type LlmJudgeCheckResult = { ok: boolean; reason: string }

/**
 * One-shot LLM rubric check for eval harness. Uses `BRAIN_EVAL_JUDGE_LLM` or {@link DEFAULT_EVAL_JUDGE_LLM}.
 */
export async function runLlmJudgeCheck(params: {
  rubricPrompt: string
  finalText: string
  modelSpec?: string
}): Promise<LlmJudgeCheckResult> {
  const spec =
    (params.modelSpec?.trim() && params.modelSpec.trim()) ||
    process.env.BRAIN_EVAL_JUDGE_LLM?.trim() ||
    DEFAULT_EVAL_JUDGE_LLM
  let provider: string
  let modelId: string
  try {
    ;({ provider, modelId } = parseBrainLlmSpec(spec))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `llm_judge_bad_model_spec: ${msg}` }
  }

  const model = resolveModel(provider, modelId)
  if (!model) {
    return { ok: false, reason: `llm_judge_unresolved_model: ${provider}/${modelId}` }
  }

  const apiKey = resolveLlmApiKey(String(model.provider))
  if (!apiKey) {
    return { ok: false, reason: `llm_judge_missing_api_key: ${String(model.provider)}` }
  }

  const userBody = `${params.rubricPrompt.trim()}\n\n---\nTUNNEL_ANSWER:\n${params.finalText.trim()}`
  const userMessage: UserMessage = { role: 'user', content: userBody, timestamp: Date.now() }

  try {
    const msg = await completeSimple(
      model,
      { systemPrompt: JUDGE_SYSTEM, messages: [userMessage] },
      {
        apiKey,
        maxTokens: 400,
        onPayload: (p, m) => chainLlmOnPayloadNoThinking(p, m),
      },
    )
    const raw = msg.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string')
      .map(c => c.text)
      .join('')
      .trim()
    return parseJudgeJson(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: `llm_judge_error: ${msg}` }
  }
}

function parseJudgeJson(raw: string): LlmJudgeCheckResult {
  let s = raw.trim()
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/u, '')
  }
  try {
    const j = JSON.parse(s) as { pass?: unknown; reason?: unknown }
    const pass = j.pass === true
    const reason = typeof j.reason === 'string' && j.reason.trim() ? j.reason.trim() : 'no reason'
    return { ok: pass, reason }
  } catch {
    return { ok: false, reason: `llm_judge_unparseable: ${raw.slice(0, 240)}` }
  }
}
