import { describe, it, expect } from 'vitest'
import { toolResultText, type ToolExecutionEndPayload } from './streamAgentSseTypes.js'

describe('streamAgentSseTypes', () => {
  it('toolResultText joins text content parts', () => {
    const ev: ToolExecutionEndPayload = {
      toolCallId: '1',
      toolName: 'x',
      result: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    }
    expect(toolResultText(ev)).toBe('ab')
  })
})
