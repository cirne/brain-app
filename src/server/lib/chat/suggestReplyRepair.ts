import { completeSimple } from '@mariozechner/pi-ai'
import type { AssistantMessage, Context } from '@mariozechner/pi-ai'
import { resolveLlmApiKey, resolveModel } from '@server/lib/llm/resolveModel.js'
import { getFastBrainLlm } from '@server/lib/llm/effectiveBrainLlm.js'
import { randomUUID } from 'node:crypto'
import { createAgentTools } from '@server/agent/tools.js'
import { chainLlmOnPayload } from '@server/lib/llm/llmOnPayloadChain.js'
import type { LlmUsageSnapshot } from '@server/lib/llm/llmUsage.js'
import type { AssistantTurnState, MessagePart } from '@server/lib/chat/chatTypes.js'
import { applyToolEnd, applyToolStart } from '@server/lib/chat/chatTranscript.js'
import { BRAIN_FINISH_CONVERSATION_SUBMIT } from '@shared/finishConversationShortcut.js'
import { assistantPartsHaveValidSuggestReply } from '@shared/suggestReplyChoicesCore.js'
import { writeSuggestReplyRepairDiagnostics } from '@server/lib/observability/agentDiagnostics.js'

const REPAIR_SYSTEM = `You output only a tool call to **suggest_reply_options**. Do not write user-facing prose.
Given the user message and the assistant answer below, supply 2–5 quick-reply chips: each choice has a short **label** (chip text) and **submit** (full user message when tapped). Make them concrete next steps based on the conversation.

**Workflow-completion priority:** When the assistant has produced a ready-to-act artifact—an email or message draft, a plan, code, a document, a form, or any output that has a natural "execute" step—always include a chip that completes the action (e.g. "Send it", "Post it", "Run it", "Submit", "Confirm", "Publish"). This chip should appear first or second, before refinement options. Refinement chips (edit, shorten, change tone, etc.) are secondary to execution when the artifact is complete and ready.

**Conversation wrap-up:** When the user's goal is clearly achieved or the conversation is winding down—task completed, question fully answered, user expressed thanks or satisfaction—include a closing chip as the last option: **label** natural language (e.g. "That's all, thanks"); **submit** exactly this string with no changes: ${BRAIN_FINISH_CONVERSATION_SUBMIT}. That submit triggers finish_conversation without a full LLM round-trip.`

const MAX_USER_CHARS = 4000
const MAX_ASSISTANT_CHARS = 14000

const FALLBACK_CHOICES = [
  { label: 'Continue', submit: 'Continue' },
  { label: 'Thanks', submit: BRAIN_FINISH_CONVERSATION_SUBMIT },
] as const

/** When unset or not \`0\`, run a repair LLM pass if the main turn omitted chips. */
export function isSuggestReplyRepairEnabled(): boolean {
  return process.env.BRAIN_SUGGEST_REPLY_REPAIR !== '0'
}

function usageFromPiAssistantMessage(m: AssistantMessage): LlmUsageSnapshot {
  const u = m.usage
  if (u == null) {
    return {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      costTotal: 0,
    }
  }
  const costTotal = u.cost && typeof u.cost.total === 'number' ? u.cost.total : 0
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    totalTokens: u.totalTokens,
    costTotal,
  }
}

function concatAssistantText(state: AssistantTurnState): string {
  const chunks: string[] = []
  for (const p of state.parts) {
    if (p.type === 'text' && p.content.trim()) chunks.push(p.content)
  }
  return chunks.join('\n\n').trim()
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n\n[…]`
}

function cloneParts(parts: MessagePart[]): MessagePart[] {
  try {
    return structuredClone(parts)
  } catch {
    return [...parts]
  }
}

export type SuggestReplyRepairResult =
  | { applied: false }
  | {
      applied: true
      toolCallId: string
      resultText: string
      details: unknown
      usage: LlmUsageSnapshot
    }

type SuggestTool = {
  name: string
  execute: (id: string, args: { choices: unknown[] }) => Promise<unknown>
}

async function applySuggestReplyToolCall(
  assistantState: AssistantTurnState,
  suggestTool: SuggestTool,
  args: unknown,
  usage: LlmUsageSnapshot,
): Promise<SuggestReplyRepairResult> {
  const snapshot = cloneParts(assistantState.parts)
  const toolCallId = randomUUID()
  applyToolStart(assistantState, {
    id: toolCallId,
    name: 'suggest_reply_options',
    args,
    done: false,
  })
  try {
    const rawResult = await suggestTool.execute(toolCallId, args as { choices: unknown[] })
    const r = rawResult as {
      content?: Array<{ type: string; text?: string }>
      details?: unknown
    }
    const resultText =
      r.content?.[0]?.type === 'text' && typeof r.content[0].text === 'string' ? r.content[0].text : ''
    const details = r.details
    const isError =
      details != null &&
      typeof details === 'object' &&
      'error' in (details as object) &&
      (details as { error?: unknown }).error != null
    applyToolEnd(assistantState, toolCallId, resultText, isError, details)
    if (isError || !assistantPartsHaveValidSuggestReply(assistantState.parts)) {
      assistantState.parts = snapshot
      return { applied: false }
    }
    return {
      applied: true,
      toolCallId,
      resultText,
      details: details ?? {},
      usage,
    }
  } catch {
    assistantState.parts = snapshot
    return { applied: false }
  }
}

/**
 * If the assistant turn has no valid `suggest_reply_options`, run a minimal second completion
 * (single tool) and apply the tool to `assistantState`, or apply a small fallback when the LLM fails.
 */
export async function runSuggestReplyRepairIfNeeded(options: {
  wikiDir: string
  userMessageText: string
  assistantState: AssistantTurnState
  includeLocalMessageTools?: boolean
  timezone?: string
  /** Correlates with main turn artifact from attachAgentDiagnosticsCollector; dev-only */
  parentAgentTurnId?: string
  sessionId?: string
}): Promise<SuggestReplyRepairResult> {
  if (!isSuggestReplyRepairEnabled()) return { applied: false }
  if (assistantPartsHaveValidSuggestReply(options.assistantState.parts)) return { applied: false }

  const userT = truncate(options.userMessageText.trim() || '(no user text)', MAX_USER_CHARS)
  const assistantT = truncate(concatAssistantText(options.assistantState), MAX_ASSISTANT_CHARS)
  if (!assistantT.length) return { applied: false }

  const tools = createAgentTools(options.wikiDir, {
    includeLocalMessageTools: options.includeLocalMessageTools ?? false,
    onlyToolNames: ['suggest_reply_options'],
    timezone: options.timezone,
  })
  const suggestTool = tools.find((t: { name?: string }) => t.name === 'suggest_reply_options') as
    | SuggestTool
    | undefined
  if (!suggestTool?.execute) return { applied: false }

  const userBody = `### User message\n\n${userT}\n\n### Assistant answer (so far)\n\n${assistantT}\n\nCall **suggest_reply_options** with 2–5 choices. If the assistant produced a ready-to-act artifact, put the execution chip first.`

  const usageZero: LlmUsageSnapshot = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costTotal: 0,
  }

  const tryFallback = () =>
    applySuggestReplyToolCall(
      options.assistantState,
      suggestTool,
      { choices: [...FALLBACK_CHOICES] },
      usageZero,
    )

  const parentAgentTurnId = options.parentAgentTurnId?.trim()
  const repairStartedAt = performance.now()

  const fast = getFastBrainLlm()
  let provider = fast.provider
  let modelId = fast.modelId
  const rP = process.env.BRAIN_SUGGEST_REPLY_REPAIR_PROVIDER?.trim()
  const rM = process.env.BRAIN_SUGGEST_REPLY_REPAIR_MODEL?.trim()
  if (rP) provider = rP
  if (rM) modelId = rM
  const model = resolveModel(provider, modelId)
  if (!model) {
    const durationMs = Math.round(performance.now() - repairStartedAt)
    if (parentAgentTurnId) {
      await writeSuggestReplyRepairDiagnostics({
        parentAgentTurnId,
        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        provider,
        modelId,
        systemPrompt: REPAIR_SYSTEM,
        userBody,
        usage: usageZero,
        durationMs,
        outcome: 'fallback',
      })
    }
    return await tryFallback()
  }

  const getApiKey = (p: string) => resolveLlmApiKey(p)

  const context: Context = {
    systemPrompt: REPAIR_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: userBody }],
        timestamp: Date.now(),
      },
    ],
    tools,
  }

  const streamOpts = {
    getApiKey,
    onPayload: (params: unknown, m: { id?: string; reasoning?: boolean }) =>
      chainLlmOnPayload(params, {
        id: typeof m.id === 'string' ? m.id : modelId,
        reasoning: m.reasoning,
        provider: model.provider,
      }),
  }

  let assistantMsg: AssistantMessage
  try {
    assistantMsg = await completeSimple(model, context, streamOpts)
  } catch (e: unknown) {
    const durationMs = Math.round(performance.now() - repairStartedAt)
    const errorMessage = e instanceof Error ? e.message : String(e)
    if (parentAgentTurnId) {
      await writeSuggestReplyRepairDiagnostics({
        parentAgentTurnId,
        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        provider,
        modelId,
        systemPrompt: REPAIR_SYSTEM,
        userBody,
        usage: usageZero,
        durationMs,
        outcome: 'error',
        errorMessage,
      })
    }
    return await tryFallback()
  }

  const usage = usageFromPiAssistantMessage(assistantMsg)
  const durAfterMainLlm = Math.round(performance.now() - repairStartedAt)
  if (parentAgentTurnId) {
    await writeSuggestReplyRepairDiagnostics({
      parentAgentTurnId,
      ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
      provider,
      modelId,
      systemPrompt: REPAIR_SYSTEM,
      userBody,
      usage,
      durationMs: durAfterMainLlm,
      outcome: 'completeSimple',
    })
  }

  const content = assistantMsg.content ?? []
  const toolCall = content.find(
    (c): c is { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> } =>
      c.type === 'toolCall' && c.name === 'suggest_reply_options',
  )
  if (toolCall) {
    const r = await applySuggestReplyToolCall(
      options.assistantState,
      suggestTool,
      { ...toolCall.arguments },
      usage,
    )
    if (r.applied) return r
    if (parentAgentTurnId) {
      await writeSuggestReplyRepairDiagnostics({
        parentAgentTurnId,
        ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
        provider,
        modelId,
        systemPrompt: REPAIR_SYSTEM,
        userBody,
        usage: usageZero,
        durationMs: Math.round(performance.now() - repairStartedAt),
        outcome: 'fallback',
      })
    }
    return await tryFallback()
  }

  return await tryFallback()
}
