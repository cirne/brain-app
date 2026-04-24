import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../agentUtils.js'
import {
  buildProfilingTranscriptEvents,
  buildSeedingProgressUi,
  extractLastMeMdWriteContent,
  extractProfilingPeople,
  extractProfilingResources,
  isProfilingMeMdPath,
  lastAssistantThinking,
  lastMeaningfulToolCall,
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

describe('isProfilingMeMdPath', () => {
  it('accepts me.md at vault root', () => {
    expect(isProfilingMeMdPath('me.md')).toBe(true)
  })

  it('rejects other wiki pages', () => {
    expect(isProfilingMeMdPath('people/jane.md')).toBe(false)
  })
})

describe('extractLastMeMdWriteContent', () => {
  it('returns content from the latest completed me.md write', () => {
    const messages: ChatMessage[] = [
      toolMsg('write', { path: 'other.md', content: 'x' }, 'ok'),
      toolMsg('write', { path: 'me.md', content: '# Profile\n\nHello.' }, 'ok'),
    ]
    expect(extractLastMeMdWriteContent(messages)).toBe('# Profile\n\nHello.')
  })

  it('returns null when me.md write is not done', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 't1',
              name: 'write',
              args: { path: 'me.md', content: 'partial' },
              result: '',
              done: false,
            },
          },
        ],
      },
    ]
    expect(extractLastMeMdWriteContent(messages)).toBe(null)
  })
})

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

  it('collects email from read_email JSON result', () => {
    const payload = JSON.stringify({
      subject: 'Hello',
      from: 'a@b.com',
      body: 'Body text here',
    })
    const messages: ChatMessage[] = [
      toolMsg('read_email', { id: 'thread-1' }, payload),
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
      toolMsg('read_email', { id: 'same' }, first),
      toolMsg('read_email', { id: 'same' }, second),
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

  it('caps the People list and reports overflow (matches find_person preview length)', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      personId: `p${i}`,
      displayName: `Person ${i}`,
      primaryAddress: `p${i}@example.com`,
    }))
    const json = JSON.stringify({ query: '', people: many })
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'fp-many',
              name: 'find_person',
              args: { query: '' },
              result: `## Email Contacts\n${json}`,
              done: true,
            },
          },
        ],
      },
    ]
    const { people, peopleOverflow } = extractProfilingPeople(messages)
    expect(people).toHaveLength(3)
    expect(peopleOverflow).toBe(2)
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
              name: 'read_email',
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
    expect(onboardingActivityLine(messages, true, 'buildout')).toBe('Writing a page…')
  })

  it('shows synthesizing when last tool finished and no thinking yet', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 's',
              name: 'search_index',
              args: { query: 'x' },
              result: 'hits',
              done: true,
            },
          },
        ],
      },
    ]
    expect(onboardingActivityLine(messages, true, 'profiling')).toBe('Synthesizing your profile…')
    expect(onboardingActivityLine(messages, true, 'buildout')).toBe('Working on your wiki…')
  })

  it('shows gathering context before any meaningful tool', () => {
    expect(onboardingActivityLine([], true, 'profiling')).toBe('Gathering context…')
    expect(onboardingActivityLine([], true, 'buildout')).toBe('Starting wiki buildout…')
  })

  it('prefers thinking snippet between tools', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        thinking: 'I will summarize themes from the last search before drafting.',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 's',
              name: 'search_index',
              args: {},
              result: 'x',
              done: true,
            },
          },
        ],
      },
    ]
    expect(onboardingActivityLine(messages, true, 'profiling')).toContain('summarize themes')
  })

  it('ignores set_chat_title when picking last tool for activity', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 't',
              name: 'set_chat_title',
              args: { title: 'Hi' },
              done: true,
            },
          },
          {
            type: 'tool',
            toolCall: {
              id: 'r',
              name: 'read_email',
              args: { id: '1' },
              done: false,
            },
          },
        ],
      },
    ]
    expect(onboardingActivityLine(messages, true, 'profiling')).toBe('Reading a message…')
    expect(lastMeaningfulToolCall(messages)?.name).toBe('read_email')
  })
})

describe('lastAssistantThinking', () => {
  it('returns latest assistant thinking', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: '', thinking: 'first' },
      { role: 'assistant', content: '', thinking: 'second' },
    ]
    expect(lastAssistantThinking(messages)).toBe('second')
  })
})

describe('buildSeedingProgressUi', () => {
  it('shows starting line when streaming and no tools yet', () => {
    const { events, planning } = buildSeedingProgressUi([], true)
    expect(events).toEqual([])
    expect(planning?.prefix).toBe('Starting wiki buildout…')
  })

  it('appends completed writes and shows active write with path', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'w1',
              name: 'write',
              args: { path: 'people/alice.md', content: 'x' },
              done: true,
            },
          },
          {
            type: 'tool',
            toolCall: {
              id: 'w2',
              name: 'write',
              args: { path: 'people/bob.md', content: 'y' },
              done: false,
            },
          },
        ],
      },
    ]
    const { events, planning } = buildSeedingProgressUi(messages, true)
    expect(events).toHaveLength(2)
    expect((events[0] as any).done).toBe(true)
    expect((events[0] as any).line.prefix).toBe('Wrote')
    expect((events[0] as any).line.path).toBe('people/alice.md')
    expect((events[1] as any).done).toBe(false)
    expect((events[1] as any).line.kind).toBe('active-tool')
    expect((events[1] as any).line.prefix).toBe('Writing')
    expect((events[1] as any).line.path).toBe('people/bob.md')
    expect(planning).toBeNull()
  })

  it('shows two in-flight write rows in parallel', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'w1',
              name: 'write',
              args: { path: 'a.md', content: 'x' },
              done: false,
            },
          },
          {
            type: 'tool',
            toolCall: {
              id: 'w2',
              name: 'write',
              args: { path: 'b.md', content: 'y' },
              done: false,
            },
          },
        ],
      },
    ]
    const { events, planning } = buildSeedingProgressUi(messages, true)
    expect(events).toHaveLength(2)
    expect(events.every((r: any) => !r.done)).toBe(true)
    expect((events[0] as any).line.path).toBe('a.md')
    expect((events[1] as any).line.path).toBe('b.md')
    expect(planning).toBeNull()
  })

  it('shows planning when last tool finished and stream still running', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 's',
              name: 'search_index',
              args: { query: 'foo' },
              result: 'hits',
              done: true,
            },
          },
        ],
      },
    ]
    const { planning } = buildSeedingProgressUi(messages, true)
    expect(planning?.kind).toBe('planning')
    expect(planning?.prefix).toBe('Working on your wiki…')
    expect(planning?.detail).toBeUndefined()
  })

  it('adds filter detail for search_index without pattern/query', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 's',
              name: 'search_index',
              args: { from: 'acme@example.com', after: '7d' },
              result: 'hits',
              done: true,
            },
          },
        ],
      },
    ]
    const { events } = buildSeedingProgressUi(messages, true)
    expect((events[0] as any).line.prefix).toBe('Searched mail')
    expect((events[0] as any).line.detail).toContain('from')
    expect((events[0] as any).line.detail).toContain('acme@example.com')
    expect((events[0] as any).line.detail).toContain('after')
  })

  it('adds mail preview to completed read_email email row', () => {
    const payload = JSON.stringify({
      subject: 'Hello from the team',
      from: 'a@b.com',
      body: 'Body',
    })
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'r',
              name: 'read_email',
              args: { id: 'mid-1' },
              result: payload,
              done: true,
            },
          },
        ],
      },
    ]
    const { events } = buildSeedingProgressUi(messages, true)
    expect((events[0] as any).line.prefix).toBe('Read a message')
    expect((events[0] as any).line.mailPreview?.subject).toBe('Hello from the team')
    expect((events[0] as any).line.mailPreview?.from).toBe('a@b.com')
    expect((events[0] as any).line.detail).toBeUndefined()
  })

  it('keeps planning headline and strips file URLs from thinking detail', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        thinking: 'Checking file:///Users/me/Library/Caches/foo.jpg for layout.',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 's',
              name: 'search_index',
              args: { query: 'x' },
              result: 'hits',
              done: true,
            },
          },
        ],
      },
    ]
    const { planning } = buildSeedingProgressUi(messages, true)
    expect(planning?.kind).toBe('planning')
    expect(planning?.prefix).toBe('Working on your wiki…')
    expect(planning?.detail).toBeDefined()
    expect(planning?.detail).not.toMatch(/file/)
    expect(planning?.detail).toContain('Checking')
  })

  it('clears planning when not streaming', () => {
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
              args: { path: 'me.md', content: 'x' },
              done: true,
            },
          },
        ],
      },
    ]
    const { events, planning } = buildSeedingProgressUi(messages, false)
    expect(events.length).toBe(1)
    expect(planning).toBeNull()
  })
})

describe('buildProfilingTranscriptEvents', () => {
  it('interleaves assistant text and completed read_email mail cards in part order', () => {
    const payload = JSON.stringify({ subject: 'Zoom recap', from: 'no@zoom.us', body: 'Hello' })
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', content: 'Checking recent mail.' },
          {
            type: 'tool',
            toolCall: {
              id: 'r1',
              name: 'read_email',
              args: { id: 'thread-a' },
              result: payload,
              done: true,
            },
          },
          { type: 'text', content: 'Summarizing patterns.' },
        ],
      },
    ]
    const ev = buildProfilingTranscriptEvents(messages)
    expect(ev).toHaveLength(3)
    expect(ev[0]).toEqual({ type: 'text', content: 'Checking recent mail.' })
    expect(ev[1].type).toBe('email')
    if (ev[1].type === 'email') {
      expect(ev[1].done).toBe(true)
      expect(ev[1].toolId).toBe('r1')
      expect(ev[1].row.subject).toBe('Zoom recap')
      expect(ev[1].row.id).toBe('thread-a')
    }
    expect(ev[2]).toEqual({ type: 'text', content: 'Summarizing patterns.' })
  })

  it('emits in-flight read_email as pending mail row', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 'r2',
              name: 'read_email',
              args: { id: 'thread-b' },
              result: '',
              done: false,
            },
          },
        ],
      },
    ]
    const ev = buildProfilingTranscriptEvents(messages)
    expect(ev).toHaveLength(1)
    expect(ev[0].type).toBe('email')
    if (ev[0].type === 'email') {
      expect(ev[0].done).toBe(false)
      expect(ev[0].row.id).toBe('thread-b')
    }
  })

  it('omits filesystem read_email and set_chat_title', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [
          {
            type: 'tool',
            toolCall: {
              id: 't',
              name: 'set_chat_title',
              args: { title: 'x' },
              result: 'ok',
              done: true,
            },
          },
          {
            type: 'tool',
            toolCall: {
              id: 'f',
              name: 'read_email',
              args: { id: '/tmp/secret.pdf' },
              result: '{}',
              done: true,
            },
          },
        ],
      },
    ]
    expect(buildProfilingTranscriptEvents(messages)).toEqual([])
  })
})

describe('profilingActivityLine', () => {
  it('delegates to profiling kind', () => {
    expect(profilingActivityLine([], false)).toBe('')
  })
})
