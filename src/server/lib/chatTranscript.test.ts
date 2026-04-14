import { describe, it, expect } from 'vitest'
import {
  applyStreamError,
  applyTextDelta,
  applyThinkingDelta,
  applyToolArgsUpsert,
  applyToolEnd,
  applyToolStart,
  createAssistantTurnState,
  extractStreamingToolCallsFromPartialAssistant,
  toAssistantMessage,
} from './chatTranscript.js'

describe('chatTranscript', () => {
  it('applies text deltas like AgentDrawer (append to last text part or new part)', () => {
    const s = createAssistantTurnState()
    applyTextDelta(s, 'Hello')
    applyTextDelta(s, ' world')
    const m = toAssistantMessage(s)
    expect(m.parts).toHaveLength(1)
    expect(m.parts![0]).toEqual({ type: 'text', content: 'Hello world' })
  })

  it('starts new text part after tool', () => {
    const s = createAssistantTurnState()
    applyTextDelta(s, 'a')
    applyToolStart(s, { id: '1', name: 'grep', args: { q: 'x' }, done: false })
    applyTextDelta(s, 'b')
    const m = toAssistantMessage(s)
    expect(m.parts).toHaveLength(3)
    expect(m.parts![0]).toEqual({ type: 'text', content: 'a' })
    expect(m.parts![1].type).toBe('tool')
    expect(m.parts![2]).toEqual({ type: 'text', content: 'b' })
  })

  it('merges thinking deltas', () => {
    const s = createAssistantTurnState()
    applyThinkingDelta(s, 'x')
    applyThinkingDelta(s, 'y')
    const m = toAssistantMessage(s)
    expect(m.thinking).toBe('xy')
  })

  it('completes tool end', () => {
    const s = createAssistantTurnState()
    applyToolStart(s, { id: 't1', name: 'read', args: { path: 'a.md' }, done: false })
    applyToolEnd(s, 't1', 'file contents', false, undefined)
    const m = toAssistantMessage(s)
    const tc = (m.parts![0] as { type: 'tool'; toolCall: { result: string; done: boolean } }).toolCall
    expect(tc.result).toBe('file contents')
    expect(tc.done).toBe(true)
  })

  it('extracts tool calls from partial assistant message', () => {
    const partial = {
      content: [
        { type: 'toolCall', id: 'call_1', name: 'write', arguments: { path: 'x.md', content: 'hi' } },
      ],
    }
    const tools = extractStreamingToolCallsFromPartialAssistant(partial)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toEqual({ id: 'call_1', name: 'write', args: { path: 'x.md', content: 'hi' } })
  })

  it('applyToolArgsUpsert appends then updates by id', () => {
    const s = createAssistantTurnState()
    applyToolArgsUpsert(s, { id: 'a', name: 'write', args: { path: 'p.md', content: 'x' }, done: false })
    expect(s.parts).toHaveLength(1)
    applyToolArgsUpsert(s, { id: 'a', name: 'write', args: { path: 'p.md', content: 'xy' }, done: false })
    expect(s.parts).toHaveLength(1)
    const tc = (s.parts[0] as { type: 'tool'; toolCall: { args: { content: string } } }).toolCall
    expect(tc.args.content).toBe('xy')
  })

  it('applyToolStart merges with existing streaming row (same id)', () => {
    const s = createAssistantTurnState()
    applyToolArgsUpsert(s, { id: 't1', name: 'grep', args: { q: 'a' }, done: false })
    applyToolStart(s, { id: 't1', name: 'grep', args: { q: 'ab' }, done: false })
    expect(s.parts).toHaveLength(1)
    expect((s.parts[0] as { type: 'tool'; toolCall: { args: { q: string } } }).toolCall.args.q).toBe('ab')
  })

  it('appends stream error as text', () => {
    const s = createAssistantTurnState()
    applyStreamError(s, 'boom')
    const m = toAssistantMessage(s)
    expect(m.parts?.some(p => p.type === 'text' && String(p.content).includes('boom'))).toBe(true)
  })
})
