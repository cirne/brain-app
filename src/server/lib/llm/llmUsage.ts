import type { AgentMessage } from '@earendil-works/pi-agent-core'

/** JSON-safe usage for chat sessions and background run docs. Keep in sync with client `LlmUsageSnapshot` in `agentUtils.ts`. */
export type LlmUsageSnapshot = {
  /**
   * New (non-cached) input tokens summed across all completions in the turn.
   * Each token is counted exactly once — the first time it enters the context.
   * Together with `output`, this gives the unique-content token count for the turn
   * (comparable to what Cursor / IDE tools show as "conversation size").
   */
  input: number
  /** Generated output tokens summed across all completions. */
  output: number
  /**
   * Cached-prefix tokens re-read on subsequent completions (billed at ~10% rate).
   * These are NOT unique tokens — the system prompt, for example, appears here once
   * per completion after the first. Do NOT add to `input` to get conversation size;
   * use `input + output` for that. Include `cacheRead` only for cost calculations.
   */
  cacheRead: number
  cacheWrite: number
  /**
   * input + cacheRead + output summed across all completions.
   * Useful only for billing context (reflects total API token traffic).
   * Overcounts for conversation-size purposes because cached context is re-counted
   * on every completion. Prefer `input + output` for a "how big is this turn" metric.
   */
  totalTokens: number
  /** Sum of `usage.cost.total` from assistant completions in the run. */
  costTotal: number
}

const ZERO: LlmUsageSnapshot = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  costTotal: 0,
}

/**
 * Sums `usage` across all assistant messages in one `agent.prompt()` / `agent_end` transcript
 * (multi tool-round runs produce multiple assistant messages).
 */
export function sumUsageFromMessages(messages: AgentMessage[] | null | undefined): LlmUsageSnapshot {
  if (!Array.isArray(messages)) return { ...ZERO }
  const out: LlmUsageSnapshot = { ...ZERO }
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    const u = m.usage
    if (u == null) continue
    out.input += u.input
    out.output += u.output
    out.cacheRead += u.cacheRead
    out.cacheWrite += u.cacheWrite
    out.totalTokens += u.totalTokens
    if (u.cost && typeof u.cost.total === 'number') {
      out.costTotal += u.cost.total
    }
  }
  return out
}

/** Number of assistant messages with `usage` in one `agent_end` transcript (one per model HTTP completion). */
export function countAssistantCompletionsWithUsage(messages: AgentMessage[] | null | undefined): number {
  if (!Array.isArray(messages)) return 0
  let n = 0
  for (const m of messages) {
    if (m.role === 'assistant' && m.usage != null) n++
  }
  return n
}

export function addLlmUsage(a: LlmUsageSnapshot, b: LlmUsageSnapshot): LlmUsageSnapshot {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    costTotal: a.costTotal + b.costTotal,
  }
}

export function isZeroUsage(s: LlmUsageSnapshot): boolean {
  return (
    s.input === 0 &&
    s.output === 0 &&
    s.cacheRead === 0 &&
    s.cacheWrite === 0 &&
    s.totalTokens === 0 &&
    s.costTotal === 0
  )
}

// --- Provider / model on assistant messages (pi-agent; same shape as newRelicHelper used privately) ---

/** `provider` / `model` on assistant messages from pi-agent-core (not on `AgentMessage` type surface). */
export function assistantLlmIdentity(m: AgentMessage): { provider?: string; model?: string } {
  if (m.role !== 'assistant') return {}
  const r = m as { provider?: unknown; model?: unknown; api?: unknown }
  const providerRaw = r.provider ?? r.api
  const provider = typeof providerRaw === 'string' && providerRaw.length > 0 ? providerRaw : undefined
  const model = typeof r.model === 'string' && r.model.length > 0 ? r.model : undefined
  return { provider, model }
}

/** Last assistant message with `usage` wins (final completion in a tool loop). */
export function rollupAssistantLlmIds(messages: AgentMessage[] | null | undefined): {
  provider?: string
  model?: string
} {
  if (!Array.isArray(messages)) return {}
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || m.usage == null) continue
    const id = assistantLlmIdentity(m)
    if (id.provider !== undefined || id.model !== undefined) return id
  }
  return {}
}
