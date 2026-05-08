import { describe, it, expect } from 'vitest'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { ToolResultMessage } from '@mariozechner/pi-ai'
import { extractEarlyRejectionFromAgentMessages } from './brainQueryEarlyRejection.js'
import { REJECT_QUESTION_TOOL_NAME } from '@shared/brainQueryReject.js'

describe('extractEarlyRejectionFromAgentMessages', () => {
  it('reads rejection from tool result details', () => {
    const tr: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call_1',
      toolName: REJECT_QUESTION_TOOL_NAME,
      content: [{ type: 'text', text: 'Too broad.' }],
      details: {
        rejected: true,
        reason: 'violates_baseline_policy',
        explanation: 'That asks for information we cannot share here.',
      },
      isError: false,
      timestamp: Date.now(),
    }
    const messages = [tr] as AgentMessage[]
    const hit = extractEarlyRejectionFromAgentMessages(messages)
    expect(hit?.reason).toBe('violates_baseline_policy')
    expect(hit?.explanation).toContain('cannot share')
  })

  it('maps model-emitted too_broad to overly_broad', () => {
    const tr: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call_2',
      toolName: REJECT_QUESTION_TOOL_NAME,
      content: [{ type: 'text', text: 'Need more detail.' }],
      details: {
        rejected: true,
        reason: 'too_broad',
        explanation: 'Too vague.',
      },
      isError: false,
      timestamp: Date.now(),
    }
    const hit = extractEarlyRejectionFromAgentMessages([tr] as AgentMessage[])
    expect(hit?.reason).toBe('overly_broad')
    expect(hit?.explanation).toContain('vague')
  })
})
