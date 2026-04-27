import {
  completeSimple,
  getEnvApiKey,
  getModel,
  type KnownProvider,
} from '@mariozechner/pi-ai'
import {
  patchOpenAiReasoningNoneEffort,
  type OpenAiResponsesPayload,
} from '@server/lib/llm/openAiResponsesPayload.js'
import { renderPromptTemplate } from '@server/lib/prompts/render.js'

const DEFAULT_PROVIDER = 'openai' as KnownProvider
const DEFAULT_MODEL = 'gpt-5.4-mini'
const DRAFT_MAX_TRANSCRIPT_CHARS = 12_000

function feedbackSystemPrompt(): string {
  return renderPromptTemplate('feedback/system.hbs', {})
}

/**
 * Produces a full markdown document (with frontmatter) suitable for
 * \`writeFeedbackIssueFromMarkdown\` after user confirmation.
 */
export async function composeFeedbackIssueMarkdown(input: {
  userMessage: string
  /** Recent chat for context, bounded. */
  transcript?: string
  /** Optional structured hints (e.g. last tool error lines). */
  toolHints?: string
}): Promise<{ markdown: string; error?: string }> {
  const provider = (process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER) as KnownProvider
  const modelId = process.env.LLM_MODEL ?? DEFAULT_MODEL
  const model = getModel(provider, modelId as never)
  if (!model) {
    return { markdown: '', error: 'LLM not configured' }
  }
  const apiKey = getEnvApiKey(provider)
  if (apiKey == null || apiKey === '') {
    return { markdown: '', error: 'No API key for current LLM provider' }
  }

  let t = (input.transcript ?? '').trim()
  if (t.length > DRAFT_MAX_TRANSCRIPT_CHARS) {
    t = t.slice(0, DRAFT_MAX_TRANSCRIPT_CHARS) + '\n\n[transcript truncated]'
  }
  const toolBit = input.toolHints?.trim()
    ? `\n\n## Tool / error hints (structured)\n${input.toolHints.trim()}\n`
    : ''
  const user = `## User request\n\n${input.userMessage.trim()}\n\n## Recent context (may be empty)\n\n${t || '_none_'}${toolBit}\n\nWrite the full markdown file now.`

  const context = {
    systemPrompt: feedbackSystemPrompt(),
    messages: [
      { role: 'user' as const, content: user, timestamp: Date.now() },
    ],
  }

  try {
    const msg = await completeSimple(model, context, {
      apiKey,
      maxTokens: 4_000,
      signal: AbortSignal.timeout(120_000),
      onPayload: (params, m) => patchOpenAiReasoningNoneEffort(params as OpenAiResponsesPayload, m),
    })
    if (msg.stopReason === 'error' || msg.errorMessage) {
      return { markdown: '', error: msg.errorMessage ?? 'LLM error' }
    }
    const parts = msg.content?.filter(
      (c): c is { type: 'text'; text: string } => c.type === 'text' && typeof c.text === 'string',
    )
    const text = parts?.map(p => p.text).join('').trim() ?? ''
    if (!text) {
      return { markdown: '', error: 'Empty LLM response' }
    }
    return { markdown: text }
  } catch (e) {
    return { markdown: '', error: e instanceof Error ? e.message : String(e) }
  }
}
