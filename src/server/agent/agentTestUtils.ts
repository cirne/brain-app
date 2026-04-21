import type { AgentToolResult } from '@mariozechner/pi-agent-core'

export function toolResultFirstText(result: AgentToolResult<unknown>): string {
  const c = result.content[0]
  if (c && 'text' in c && typeof c.text === 'string') return c.text
  throw new Error('expected first tool result block to be text')
}

export function joinToolResultText(result: AgentToolResult<unknown>): string {
  return result.content
    .map((c) => ('text' in c && typeof c.text === 'string' ? c.text : ''))
    .join('')
}
