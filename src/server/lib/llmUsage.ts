import type { AgentMessage } from '@mariozechner/pi-agent-core'

/** JSON-safe usage for chat sessions and background run docs. Keep in sync with client `LlmUsageSnapshot` in `agentUtils.ts`. */
export type LlmUsageSnapshot = {
  input: number
  output: number
  /** Provider prompt cache read (cached input), per pi-ai. */
  cacheRead: number
  cacheWrite: number
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
