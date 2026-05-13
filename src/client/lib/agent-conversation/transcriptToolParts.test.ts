import { describe, it, expect } from 'vitest'
import { expandPartsForToolDisplay } from './transcriptToolParts.js'
import type { MessagePart, ToolPart } from '../agentUtils.js'

function tool(id: string, name: string, opts?: { isError?: boolean; done?: boolean }): MessagePart {
  return {
    type: 'tool',
    toolCall: {
      id,
      name,
      args: {},
      done: opts?.done ?? true,
      isError: opts?.isError,
    },
  }
}

describe('expandPartsForToolDisplay', () => {
  it('returns a copy unchanged for compact', () => {
    const parts: MessagePart[] = [tool('1', 'search_index'), tool('2', 'search_index')]
    const r = expandPartsForToolDisplay(parts, 'compact', 'assistant')
    expect(r).toEqual(parts)
    expect(r).not.toBe(parts)
  })

  it('returns unchanged for user role', () => {
    const parts: MessagePart[] = [tool('1', 'search_index'), tool('2', 'search_index')]
    expect(expandPartsForToolDisplay(parts, 'focused', 'user')).toEqual(parts)
  })

  it('collapses consecutive ephemeral tools to the last', () => {
    const parts: MessagePart[] = [
      tool('1', 'search_index'),
      tool('2', 'search_index'),
      tool('3', 'find_person'),
    ]
    const r = expandPartsForToolDisplay(parts, 'focused', 'assistant')
    expect(r).toEqual([tool('3', 'find_person')])
  })

  it('keeps sticky open between ephemeral runs', () => {
    const parts: MessagePart[] = [
      tool('1', 'search_index'),
      tool('2', 'search_index'),
      tool('3', 'open'),
      tool('4', 'search_index'),
      tool('5', 'read_mail_message'),
    ]
    const r = expandPartsForToolDisplay(parts, 'focused', 'assistant')
    expect(r).toEqual([tool('2', 'search_index'), tool('3', 'open'), tool('5', 'read_mail_message')])
  })

  it('pins error tools so they are not dropped', () => {
    const parts: MessagePart[] = [
      tool('1', 'search_index'),
      { type: 'tool', toolCall: { id: '2', name: 'search_index', args: {}, done: true, isError: true } },
      tool('3', 'search_index'),
    ]
    const r = expandPartsForToolDisplay(parts, 'focused', 'assistant')
    expect(r).toHaveLength(3)
    expect(r[0]).toEqual(tool('1', 'search_index'))
    expect((r[1] as ToolPart).toolCall.isError).toBe(true)
    expect(r[2]).toEqual(tool('3', 'search_index'))
  })

  it('does not merge across text', () => {
    const parts: MessagePart[] = [
      tool('1', 'search_index'),
      { type: 'text', content: 'Hi' },
      tool('2', 'search_index'),
    ]
    const r = expandPartsForToolDisplay(parts, 'focused', 'assistant')
    expect(r).toEqual([tool('1', 'search_index'), { type: 'text', content: 'Hi' }, tool('2', 'search_index')])
  })

  it('does not collapse through hidden transcript tools', () => {
    const parts: MessagePart[] = [tool('1', 'search_index'), tool('2', 'set_chat_title'), tool('3', 'search_index')]
    const r = expandPartsForToolDisplay(parts, 'focused', 'assistant')
    expect(r).toEqual([tool('1', 'search_index'), tool('2', 'set_chat_title'), tool('3', 'search_index')])
  })

  it('keeps present_visual_artifact sticky with following ephemerals collapsed to one', () => {
    const parts: MessagePart[] = [
      tool('1', 'present_visual_artifact'),
      tool('2', 'search_index'),
      tool('3', 'search_index'),
    ]
    const r = expandPartsForToolDisplay(parts, 'focused', 'assistant')
    expect(r).toEqual([tool('1', 'present_visual_artifact'), tool('3', 'search_index')])
  })
})
