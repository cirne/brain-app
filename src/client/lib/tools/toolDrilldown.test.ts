import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../agentUtils.js'
import { toolDrilldownForTool } from './toolDrilldown.js'

function tc(p: Partial<ToolCall> & Pick<ToolCall, 'name'>): ToolCall {
  return {
    id: 't1',
    args: {},
    done: true,
    ...p,
  } as ToolCall
}

describe('toolDrilldownForTool', () => {
  it('opens wiki previews', () => {
    expect(
      toolDrilldownForTool(
        tc({ name: 'read', args: { path: 'notes/today' }, result: 'body' }),
      ),
    ).toEqual({ kind: 'wiki', path: 'notes/today.md' })
  })

  it('opens raw file previews', () => {
    expect(
      toolDrilldownForTool(
        tc({ name: 'read', args: { path: '/Users/me/file.txt' }, result: 'body' }),
      ),
    ).toEqual({ kind: 'file', path: '/Users/me/file.txt' })
  })

  it('opens email previews', () => {
    expect(
      toolDrilldownForTool(
        tc({
          name: 'read_email',
          args: { id: 'msg-1' },
          result: JSON.stringify({ subject: 'Hello', from: 'a@example.com', bodyText: 'Body' }),
        }),
      ),
    ).toEqual({ kind: 'email', id: 'msg-1', subject: 'Hello', from: 'a@example.com' })
  })

  it('opens draft previews', () => {
    expect(
      toolDrilldownForTool(
        tc({
          name: 'draft_email',
          details: { id: 'draft-1', subject: 'Draft subject', body: 'Body' },
          result: '{"id":"draft-1"}',
        }),
      ),
    ).toEqual({ kind: 'email_draft', draftId: 'draft-1', subject: 'Draft subject' })
  })

  it('opens calendar previews by start date', () => {
    expect(
      toolDrilldownForTool(
        tc({
          name: 'get_calendar_events',
          args: { start: '2026-04-30', end: '2026-05-01' },
          result: '[]',
        }),
      ),
    ).toEqual({ kind: 'calendar', date: '2026-04-30' })
  })

  it('opens message thread previews', () => {
    expect(
      toolDrilldownForTool(
        tc({
          name: 'get_message_thread',
          args: { chat_identifier: '+15551234567' },
          details: {
            messageThreadPreview: true,
            canonical_chat: '+15551234567',
            chat: 'Donna',
            preview_messages: [],
          },
          result: 'ok',
        }),
      ),
    ).toEqual({ kind: 'message_thread', canonicalChat: '+15551234567', displayLabel: 'Donna' })
  })

  it('opens full inbox from inbox list previews', () => {
    expect(
      toolDrilldownForTool(
        tc({
          name: 'list_inbox',
          result: 'Important\nFrom: A\nSubject: One\nID: msg-1',
        }),
      ),
    ).toEqual({ kind: 'inbox' })
  })

  it('opens mail search results from search previews', () => {
    const drilldown = toolDrilldownForTool(
      tc({
        name: 'search_index',
        args: { pattern: 'invoice' },
        result: JSON.stringify({
          results: [{ messageId: 'msg-1', subject: 'Invoice', fromAddress: 'a@example.com' }],
          totalMatched: 1,
        }),
      }),
    )

    expect(drilldown?.kind).toBe('mail_search')
    if (drilldown?.kind !== 'mail_search') return
    expect(drilldown.preview.queryLine).toContain('invoice')
    expect(drilldown.preview.items[0].id).toBe('msg-1')
  })

  it('returns null for non-actionable tool calls', () => {
    expect(toolDrilldownForTool(tc({ name: 'find_person', result: '{"people":[]}' }))).toBeNull()
  })
})
