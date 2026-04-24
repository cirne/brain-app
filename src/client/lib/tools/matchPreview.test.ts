import { describe, expect, it } from 'vitest'
import { extractProductFeedbackDraftMarkdown, matchContentPreview } from './matchPreview.js'
import type { ToolCall } from '../agentUtils.js'

function tc(p: Partial<ToolCall> & Pick<ToolCall, 'name'>): ToolCall {
  return {
    id: 't1',
    args: {},
    done: true,
    ...p,
  } as ToolCall
}

describe('matchContentPreview', () => {
  it('parses search_index JSON into mail_search_hits', () => {
    const json = JSON.stringify({
      results: [
        {
          messageId: '<m1@x.com>',
          subject: 'Hello',
          fromAddress: 'a@b.com',
          snippet: 'Test <b>snippet</b>',
        },
        {
          messageId: '<m2@x.com>',
          subject: 'Re: World',
          fromName: 'Bob',
          snippet: 'Line',
        },
      ],
      totalMatched: 42,
    })
    const prev = matchContentPreview(
      tc({
        name: 'search_index',
        args: { pattern: 'invoice|receipt' },
        result: json,
      }),
    )
    expect(prev?.kind).toBe('mail_search_hits')
    if (prev?.kind !== 'mail_search_hits') return
    expect(prev.queryLine).toContain('invoice')
    expect(prev.items).toHaveLength(2)
    expect(prev.items[0].subject).toBe('Hello')
    expect(prev.items[0].snippet).not.toContain('<')
    expect(prev.totalMatched).toBe(42)
  })

  it('find_person shows query line and people from JSON', () => {
    const json = JSON.stringify({
      people: [
        {
          personId: 'p1',
          primaryAddress: 'jane@ex.com',
          displayName: 'Jane Doe',
        },
      ],
    })
    const prev = matchContentPreview(
      tc({
        name: 'find_person',
        args: { query: 'jane' },
        result: json,
      }),
    )
    expect(prev?.kind).toBe('find_person_hits')
    if (prev?.kind !== 'find_person_hits') return
    expect(prev.queryLine).toContain('jane')
    expect(prev.people[0].name).toBe('Jane Doe')
    expect(prev.people[0].email).toBe('jane@ex.com')
  })

  it('find_person top contacts label when query empty', () => {
    const prev = matchContentPreview(
      tc({
        name: 'find_person',
        args: { query: '' },
        result: '{"people":[]}',
      }),
    )
    expect(prev?.kind).toBe('find_person_hits')
    if (prev?.kind !== 'find_person_hits') return
    expect(prev.queryLine).toContain('Top contacts')
  })

  it('product_feedback draft maps to feedback_draft with body markdown only', () => {
    const body = '---\ntype: bug\ntitle: Test issue\n---\n\n## Summary\n\n- a'
    const result =
      'Feedback draft (show this to the user; do not save until they confirm):\n\n' + body
    const prev = matchContentPreview(
      tc({
        name: 'product_feedback',
        args: { op: 'draft' },
        result,
      }),
    )
    expect(prev?.kind).toBe('feedback_draft')
    if (prev?.kind !== 'feedback_draft') return
    expect(prev.markdown).toBe(body)
  })

  it('product_feedback non-draft result has no feedback_draft preview', () => {
    const prev = matchContentPreview(
      tc({
        name: 'product_feedback',
        args: { op: 'submit' },
        result: 'Saved feedback as issue #1 (i-1.md)',
      }),
    )
    expect(prev).toBeNull()
  })
})

describe('extractProductFeedbackDraftMarkdown', () => {
  it('returns markdown after the draft prefix', () => {
    const md = '---\ntype: feature\ntitle: x\n---\n\nok'
    const out = extractProductFeedbackDraftMarkdown(
      'Feedback draft (show this to the user; do not save until they confirm):\n\n' + md,
    )
    expect(out).toBe(md)
  })

  it('returns null for other tool text', () => {
    expect(extractProductFeedbackDraftMarkdown('Draft failed: no')).toBeNull()
  })
})
