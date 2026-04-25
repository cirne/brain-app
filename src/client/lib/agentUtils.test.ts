import { describe, it, expect } from 'vitest'
import {
  assistantHasVisibleTextPart,
  extractReferencedFiles,
  extractMentionedFiles,
  buildChatBody,
  contextPlaceholder,
  type ChatMessage,
} from './agentUtils.js'
import type { SurfaceContext } from '../router.js'

describe('extractReferencedFiles', () => {
  it('returns empty array for empty messages', () => {
    expect(extractReferencedFiles([])).toEqual([])
  })

  it('ignores user messages', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'check projects/alpha.md' }]
    expect(extractReferencedFiles(msgs)).toEqual([])
  })

  it('extracts .md path from tool call args', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: { id: '1', name: 'read', args: { path: 'projects/alpha.md' }, done: true },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual(['projects/alpha.md'])
  })

  it('omits read tool paths when the read failed', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: {
          id: '1',
          name: 'read',
          args: { path: 'wiki/me.md' },
          done: true,
          isError: true,
        },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual([])
  })

  it('omits read tool paths until the call has finished', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: { id: '1', name: 'read', args: { path: 'me.md' }, done: false },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual([])
  })

  it('omits write tool paths until the call has finished', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: {
          id: 'w1',
          name: 'write',
          args: { path: 'trips/wedding.md', content: '' },
          done: false,
        },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual([])
  })

  it('omits write tool paths when the write failed', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: {
          id: 'w1',
          name: 'write',
          args: { path: 'trips/wedding.md', content: 'x' },
          done: true,
          isError: true,
        },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual([])
  })

  it('includes write tool path when the write succeeded', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: {
          id: 'w1',
          name: 'write',
          args: { path: 'trips/wedding.md', content: '# Hi' },
          done: true,
        },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual(['trips/wedding.md'])
  })

  it('ignores tool call args that are not .md files', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{
        type: 'tool',
        toolCall: { id: '1', name: 'grep', args: { path: 'something.txt' }, done: true },
      }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual([])
  })

  it('extracts wiki: links with .md extension from text parts', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{ type: 'text', content: 'See [project](wiki:projects/alpha.md) for details.' }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual(['projects/alpha.md'])
  })

  it('appends .md to wiki: links without extension', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [{ type: 'text', content: 'See [person](wiki:people/alice) for context.' }],
    }]
    expect(extractReferencedFiles(msgs)).toEqual(['people/alice.md'])
  })

  it('deduplicates across multiple messages', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        parts: [{ type: 'text', content: 'See [alpha](wiki:projects/alpha.md).' }],
      },
      {
        role: 'assistant',
        content: '',
        parts: [{
          type: 'tool',
          toolCall: { id: '2', name: 'read', args: { path: 'projects/alpha.md' }, done: true },
        }],
      },
    ]
    expect(extractReferencedFiles(msgs)).toEqual(['projects/alpha.md'])
  })

  it('preserves insertion order across multiple files', () => {
    const msgs: ChatMessage[] = [{
      role: 'assistant',
      content: '',
      parts: [
        { type: 'text', content: 'See [alpha](wiki:a.md) and [beta](wiki:b.md).' },
      ],
    }]
    expect(extractReferencedFiles(msgs)).toEqual(['a.md', 'b.md'])
  })
})

describe('extractMentionedFiles', () => {
  it('returns empty array when no @mentions', () => {
    expect(extractMentionedFiles('just a regular message')).toEqual([])
  })

  it('extracts a single @mention', () => {
    expect(extractMentionedFiles('look at @projects/alpha.md please')).toEqual(['projects/alpha.md'])
  })

  it('extracts multiple @mentions', () => {
    expect(extractMentionedFiles('@a.md and @b/c.md')).toEqual(['a.md', 'b/c.md'])
  })

  it('ignores @mentions without .md extension', () => {
    expect(extractMentionedFiles('@person or @company')).toEqual([])
  })
})

describe('buildChatBody', () => {
  const noContext: SurfaceContext = { type: 'none' }

  it('always includes message and timezone', () => {
    const body = buildChatBody({ message: 'hello', sessionId: null, context: noContext, mentionedFiles: [], isFirstMessage: true })
    expect(body.message).toBe('hello')
    expect(typeof body.timezone).toBe('string')
  })

  it('includes sessionId when provided', () => {
    const body = buildChatBody({ message: 'hi', sessionId: 'sess-123', context: noContext, mentionedFiles: [], isFirstMessage: true })
    expect(body.sessionId).toBe('sess-123')
  })

  it('omits sessionId when null', () => {
    const body = buildChatBody({ message: 'hi', sessionId: null, context: noContext, mentionedFiles: [], isFirstMessage: true })
    expect('sessionId' in body).toBe(false)
  })

  it('includes surface context string on first message', () => {
    const ctx: SurfaceContext = { type: 'email', threadId: 'msg:1', subject: 'Budget', from: 'alice@x.com' }
    const body = buildChatBody({ message: 'summarize', sessionId: null, context: ctx, mentionedFiles: [], isFirstMessage: true })
    expect(body.context as string).toContain('Budget')
    expect(body.context as string).toContain('alice@x.com')
  })

  it('omits context on non-first messages', () => {
    const ctx: SurfaceContext = { type: 'email', threadId: 'msg:1', subject: 'Budget', from: 'alice@x.com' }
    const body = buildChatBody({ message: 'follow up', sessionId: 'sess-1', context: ctx, mentionedFiles: [], isFirstMessage: false })
    expect('context' in body).toBe(false)
  })

  it('appends mentioned files to context on first message', () => {
    const body = buildChatBody({
      message: 'check @projects/alpha.md',
      sessionId: null,
      context: noContext,
      mentionedFiles: ['projects/alpha.md'],
      isFirstMessage: true,
    })
    expect(body.context as string).toContain('projects/alpha.md')
  })

  it('omits context field entirely when type is none and no mentions', () => {
    const body = buildChatBody({ message: 'hello', sessionId: null, context: noContext, mentionedFiles: [], isFirstMessage: true })
    expect('context' in body).toBe(false)
  })

  it('firstChatKickoff omits message and sets flag', () => {
    const body = buildChatBody({
      message: 'ignored',
      sessionId: null,
      context: noContext,
      mentionedFiles: [],
      isFirstMessage: true,
      firstChatKickoff: true,
    })
    expect(body.firstChatKickoff).toBe(true)
    expect('message' in body).toBe(false)
    expect(typeof body.timezone).toBe('string')
  })

  it('sets hearReplies when true', () => {
    const body = buildChatBody({
      message: 'hi',
      sessionId: 's-1',
      context: noContext,
      mentionedFiles: [],
      isFirstMessage: false,
      hearReplies: true,
    })
    expect(body.hearReplies).toBe(true)
  })

  it('omits hearReplies when false or undefined', () => {
    const a = buildChatBody({
      message: 'hi',
      sessionId: null,
      context: noContext,
      mentionedFiles: [],
      isFirstMessage: true,
    })
    expect('hearReplies' in a).toBe(false)
  })
})

describe('assistantHasVisibleTextPart', () => {
  it('is false for empty or missing parts', () => {
    expect(assistantHasVisibleTextPart({ role: 'assistant', content: '' })).toBe(false)
    expect(assistantHasVisibleTextPart({ role: 'assistant', content: '', parts: [] })).toBe(false)
  })

  it('is false when only empty or whitespace text parts exist', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [{ type: 'text', content: '' }, { type: 'text', content: '  \n' }],
    }
    expect(assistantHasVisibleTextPart(msg)).toBe(false)
  })

  it('is false when only tool parts exist', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [
        { type: 'tool', toolCall: { id: '1', name: 'inbox', args: {}, done: false } },
      ],
    }
    expect(assistantHasVisibleTextPart(msg)).toBe(false)
  })

  it('is true when a text part has non-whitespace content', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [
        { type: 'tool', toolCall: { id: '1', name: 'inbox', args: {}, done: true } },
        { type: 'text', content: 'Here is the summary.' },
      ],
    }
    expect(assistantHasVisibleTextPart(msg)).toBe(true)
  })
})

describe('contextPlaceholder', () => {
  it('returns email placeholder for email context', () => {
    const ctx: SurfaceContext = { type: 'email', threadId: 'x', subject: 'y', from: 'z' }
    expect(contextPlaceholder(ctx)).toBe('What do you want to do with this email?')
  })

  it('returns docs placeholder for wiki context', () => {
    const ctx: SurfaceContext = { type: 'wiki', path: 'a.md', title: 'A' }
    expect(contextPlaceholder(ctx)).toBe('Edit, expand, or ask about this page…')
  })

  it('returns calendar placeholder for calendar context', () => {
    const ctx: SurfaceContext = { type: 'calendar', date: '2026-04-13' }
    expect(contextPlaceholder(ctx)).toBe('Ask about your schedule...')
  })

  it('returns chat placeholder for chat context', () => {
    const ctx: SurfaceContext = { type: 'chat' }
    expect(contextPlaceholder(ctx)).toContain('mind')
  })

  it('returns generic placeholder for none context', () => {
    const ctx: SurfaceContext = { type: 'none' }
    expect(contextPlaceholder(ctx)).toBe('Ask anything...')
  })
})
