import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../agentUtils.js'
import {
  extractProfilingPeople,
  extractProfilingResources,
  onboardingActivityLine,
  parseFindPersonResultPeople,
  profilingActivityLine,
} from './profilingResources.js'

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

  it('caps wiki paths and reports overflow', () => {
    const messages: ChatMessage[] = []
    for (let i = 0; i < 45; i++) {
      messages.push(toolMsg('write', { path: `p${i}.md`, content: 'x' }, 'ok'))
    }
    const { wikiPaths, wikiOverflow } = extractProfilingResources(messages)
    expect(wikiPaths.length).toBe(40)
    expect(wikiOverflow).toBe(5)
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

describe('parseFindPersonResultPeople', () => {
  it('parses ripmail who JSON with displayName', () => {
    const raw = `## Email Contacts (top by frequency)\n${JSON.stringify(
      {
        query: '',
        people: [
          {
            personId: 'p1',
            displayName: 'Pat Smith',
            primaryAddress: 'pat@example.com',
            sentCount: 3,
            receivedCount: 1,
          },
        ],
      },
      null,
      2,
    )}`
    const people = parseFindPersonResultPeople(raw)
    expect(people).toHaveLength(1)
    expect(people[0].name).toBe('Pat Smith')
    expect(people[0].email).toBe('pat@example.com')
    expect(people[0].id).toBe('id:p1')
  })

  it('returns empty array for JSON with empty people (no text fallback)', () => {
    const raw = `## x\n${JSON.stringify({ query: 'x', people: [] })}`
    expect(parseFindPersonResultPeople(raw)).toEqual([])
  })

  it('parses text line from fake ripmail', () => {
    const raw = '## Email Contacts (top by frequency)\nAlice Example <alice@example.com> (42 emails)\n'
    const people = parseFindPersonResultPeople(raw)
    expect(people).toHaveLength(1)
    expect(people[0].name).toBe('Alice Example')
    expect(people[0].email).toBe('alice@example.com')
  })
})

describe('extractProfilingPeople', () => {
  it('collects people from completed find_person tools in order', () => {
    const json = JSON.stringify({
      query: 'bob',
      people: [
        { personId: 'pb', displayName: 'Bob Jones', primaryAddress: 'bob@example.com' },
      ],
    })
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'fp1',
              name: 'find_person',
              args: { query: 'bob' },
              result: `## Email Contacts\n${json}`,
              done: true,
            },
          },
        ],
      },
    ]
    const { people, peopleOverflow } = extractProfilingPeople(messages)
    expect(peopleOverflow).toBe(0)
    expect(people).toHaveLength(1)
    expect(people[0].name).toBe('Bob Jones')
  })
})

describe('onboardingActivityLine', () => {
  it('returns empty when not streaming', () => {
    expect(onboardingActivityLine([], false, 'profiling')).toBe('')
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
    expect(onboardingActivityLine(messages, true, 'profiling')).toBe('Reading a message…')
  })

  it('uses seeding labels for write', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'w',
              name: 'write',
              args: { path: 'topics/foo.md', content: 'x' },
              done: false,
            },
          },
        ],
      },
    ]
    expect(onboardingActivityLine(messages, true, 'profiling')).toBe('Writing your profile…')
    expect(onboardingActivityLine(messages, true, 'seeding')).toBe('Writing a page…')
  })
})

describe('profilingActivityLine', () => {
  it('delegates to profiling kind', () => {
    expect(profilingActivityLine([], false)).toBe('')
  })
})
