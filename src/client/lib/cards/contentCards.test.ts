import { describe, it, expect } from 'vitest'
import { matchContentPreview, wikiPathForReadToolArg } from './contentCards.js'
import type { ToolCall } from '../agentUtils.js'

function tc(p: Partial<ToolCall> & Pick<ToolCall, 'id' | 'name'>): ToolCall {
  return {
    args: {},
    done: true,
    ...p,
  } as ToolCall
}

describe('matchContentPreview', () => {
  it('returns calendar preview for get_calendar_events JSON result', () => {
    const tool = tc({
      id: '1',
      name: 'get_calendar_events',
      done: true,
      args: { start: '2026-04-14', end: '2026-04-14' },
      result: JSON.stringify([
        {
          id: 'e1',
          title: 'Meet',
          start: '2026-04-14T15:00:00Z',
          end: '2026-04-14T16:00:00Z',
          allDay: false,
          source: 'personal' as const,
        },
      ]),
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('calendar')
    if (p?.kind === 'calendar') {
      expect(p.events.length).toBe(1)
      expect(p.start).toBe('2026-04-14')
    }
  })

  it('returns wiki preview for read .md', () => {
    const tool = tc({
      id: '2',
      name: 'read',
      done: true,
      args: { path: 'ideas/foo.md' },
      result: '# Foo\n\nHello world content here.',
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('wiki')
    if (p?.kind === 'wiki') {
      expect(p.path).toBe('ideas/foo.md')
      expect(p.excerpt).toContain('Hello')
    }
  })

  it('returns wiki preview for read path without .md suffix (agent convention)', () => {
    const tool = tc({
      id: '2b',
      name: 'read',
      done: true,
      args: { path: 'travel/sterling-wedding' },
      result: '# Trip\n\nVenue details here.',
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('wiki')
    if (p?.kind === 'wiki') {
      expect(p.path).toBe('travel/sterling-wedding.md')
      expect(p.excerpt).toContain('Venue')
    }
  })

  it('wikiPathForReadToolArg leaves explicit non-md extensions unchanged', () => {
    expect(wikiPathForReadToolArg('data/config.json')).toBe('data/config.json')
  })

  it('returns email preview for read_email with object from and body', () => {
    const tool = tc({
      id: 'e1',
      name: 'read_email',
      done: true,
      args: { id: 'msg-1' },
      result: JSON.stringify({
        subject: 'Trip plan',
        from: { name: 'Kirsten Vliet', address: 'k@mac.com' },
        body: 'Hello there. '.repeat(30),
      }),
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('email')
    if (p?.kind === 'email') {
      expect(p.from).toContain('Kirsten')
      expect(p.from).toContain('k@mac.com')
      expect(p.subject).toBe('Trip plan')
      expect(p.snippet.length).toBeGreaterThan(10)
    }
  })

  it('read_email preview uses details when result JSON is truncated (invalid parse)', () => {
    const tool = tc({
      id: 'e-trunc',
      name: 'read_email',
      done: true,
      args: { id: 'CABA-big' },
      result: '{"subject":"Re: X","from":"a@b.com","body":"' + 'x'.repeat(5000), // truncated mid-string — parse fails
      details: {
        readEmailPreview: true,
        id: 'CABA-big',
        subject: 'Re: Autem Call Tomorrow',
        from: 'Daniel Scholnick <dan@x.com>',
        snippet: 'On Mon, Lew…',
      },
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('email')
    if (p?.kind === 'email') {
      expect(p.id).toBe('CABA-big')
      expect(p.subject).toBe('Re: Autem Call Tomorrow')
      expect(p.snippet).toBe('On Mon, Lew…')
    }
  })

  it('returns null when tool is still running', () => {
    const tool = tc({
      id: '3',
      name: 'read',
      args: { path: 'x.md' },
      done: false,
      result: 'x',
    })
    expect(matchContentPreview(tool)).toBeNull()
  })

  it('list_inbox preview uses details when result text is truncated invalid JSON', () => {
    const big = { mailboxes: [{ items: [{ messageId: 'x', subject: 'S', fromName: 'A', action: 'read' }] }] }
    const tool = tc({
      id: 'inbox-trunc',
      name: 'list_inbox',
      done: true,
      result: '{"mailboxes":[', // truncated — parse fails on text alone
      details: big,
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('inbox_list')
    if (p?.kind === 'inbox_list') {
      expect(p.items).toHaveLength(1)
      expect(p.items[0].id).toBe('x')
    }
  })

  it('returns inbox_list preview with full item list and totalCount (widget shows up to 5 at a time)', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      messageId: `msg-${i}`,
      fromName: `User ${i}`,
      subject: `Sub ${i}`,
      date: '2026-04-12',
      snippet: 'Hi',
      action: 'read',
    }))
    const tool = tc({
      id: 'inbox-1',
      name: 'list_inbox',
      done: true,
      result: JSON.stringify({ mailboxes: [{ items: rows }] }),
    })
    const p = matchContentPreview(tool)
    expect(p?.kind).toBe('inbox_list')
    if (p?.kind === 'inbox_list') {
      expect(p.items).toHaveLength(7)
      expect(p.totalCount).toBe(7)
      expect(p.items[0].id).toBe('msg-0')
      expect(p.items[6].id).toBe('msg-6')
    }
  })

})
