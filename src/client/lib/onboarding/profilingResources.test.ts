import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../agentUtils.js'
import { extractProfilingResources, profilingActivityLine } from './profilingResources.js'

function toolMsg(name: string, args: Record<string, unknown>, result: string, done = true): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    parts: [
      {
        type: 'tool',
        toolCall: {
          id: `t-${name}`,
          name,
          args,
          result,
          done,
        },
      },
    ],
  }
}

describe('extractProfilingResources', () => {
  it('collects wiki paths from write preview', () => {
    const messages: ChatMessage[] = [
      toolMsg('write', { path: 'me.md', content: '# Hi\n' }, 'ok'),
    ]
    const { wikiPaths, emails } = extractProfilingResources(messages)
    expect(wikiPaths).toEqual(['me.md'])
    expect(emails).toEqual([])
  })

  it('dedupes wiki paths', () => {
    const messages: ChatMessage[] = [
      toolMsg('write', { path: 'me.md', content: 'a' }, 'ok'),
      toolMsg('read', { path: 'me.md' }, '# body'),
    ]
    const { wikiPaths } = extractProfilingResources(messages)
    expect(wikiPaths).toEqual(['me.md'])
  })

  it('collects email from read_doc JSON result', () => {
    const payload = JSON.stringify({
      subject: 'Hello',
      from: 'a@b.com',
      body: 'Body text here',
    })
    const messages: ChatMessage[] = [
      toolMsg('read_doc', { id: 'thread-1' }, payload),
    ]
    const { wikiPaths, emails } = extractProfilingResources(messages)
    expect(wikiPaths).toEqual([])
    expect(emails).toHaveLength(1)
    expect(emails[0].id).toBe('thread-1')
    expect(emails[0].subject).toBe('Hello')
    expect(emails[0].from).toBe('a@b.com')
  })

  it('keeps latest email row when same id appears twice', () => {
    const first = JSON.stringify({ subject: 'Old', from: 'x@y.com', body: 'a' })
    const second = JSON.stringify({ subject: 'New', from: 'x@y.com', body: 'b' })
    const messages: ChatMessage[] = [
      toolMsg('read_doc', { id: 'same' }, first),
      toolMsg('read_doc', { id: 'same' }, second),
    ]
    const { emails } = extractProfilingResources(messages)
    expect(emails).toHaveLength(1)
    expect(emails[0].subject).toBe('New')
  })

  it('ignores incomplete tools', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'x',
              name: 'write',
              args: { path: 'me.md', content: 'a' },
              done: false,
            },
          },
        ],
      },
    ]
    const { wikiPaths } = extractProfilingResources(messages)
    expect(wikiPaths).toEqual([])
  })
})

describe('profilingActivityLine', () => {
  it('returns empty when not streaming', () => {
    expect(profilingActivityLine([], false)).toBe('')
  })

  it('maps last in-flight tool while streaming', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'x',
              name: 'read_doc',
              args: { id: '1' },
              done: false,
            },
          },
        ],
      },
    ]
    expect(profilingActivityLine(messages, true)).toBe('Reading a message…')
  })
})
