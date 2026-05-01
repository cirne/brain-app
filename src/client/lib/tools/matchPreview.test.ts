import { describe, expect, it } from 'vitest'
import { extractProductFeedbackDraftMarkdown, matchContentPreview, searchHitIsIndexedFile } from './matchPreview.js'
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

  it('parses search_index JSON after adaptive resolution suffix', () => {
    const json = JSON.stringify({
      results: [
        {
          messageId: 'file-id-1',
          subject: 'Report.pdf',
          fromAddress: '',
          fromName: null,
          sourceKind: 'googleDrive',
        },
      ],
      totalMatched: 1,
    })
    const suffix = '\n\n[resolution: compact — 1 results, snippet omitted. Total matched: 1.]'
    const prev = matchContentPreview(
      tc({
        name: 'search_index',
        args: { pattern: '.', source: 'acct-drive' },
        result: json + suffix,
      }),
    )
    expect(prev?.kind).toBe('mail_search_hits')
    if (prev?.kind !== 'mail_search_hits') return
    expect(prev.items).toHaveLength(1)
    expect(prev.items[0].subject).toBe('Report.pdf')
    expect(prev.items[0].sourceKind).toBe('googleDrive')
    expect(prev.searchSource).toBe('acct-drive')
    expect(prev.totalMatched).toBe(1)
  })

  it('search_index unwraps tool result content wrapper before parsing', () => {
    const inner = JSON.stringify({
      results: [{ messageId: 'm1', subject: 'Hi', fromAddress: 'a@b.com', snippet: 'x' }],
      totalMatched: 1,
    })
    const wrapped = JSON.stringify({ content: [{ type: 'text', text: inner }] })
    const prev = matchContentPreview(
      tc({
        name: 'search_index',
        args: { pattern: 'hi' },
        result: wrapped,
      }),
    )
    expect(prev?.kind).toBe('mail_search_hits')
    if (prev?.kind !== 'mail_search_hits') return
    expect(prev.items).toHaveLength(1)
    expect(prev.items[0].id).toBe('m1')
  })

  it('searchHitIsIndexedFile uses sourceKind and fallbacks', () => {
    expect(
      searchHitIsIndexedFile(
        { id: '1', subject: 'a.pdf', from: '', snippet: '', sourceKind: 'googleDrive' },
      ),
    ).toBe(true)
    expect(
      searchHitIsIndexedFile(
        { id: '1', subject: 'Hi', from: 'x@y.com', snippet: '', sourceKind: 'imap' },
      ),
    ).toBe(false)
    expect(
      searchHitIsIndexedFile({ id: '1', subject: 'doc.pdf', from: '', snippet: '' }, 'inbox-drive'),
    ).toBe(true)
    expect(
      searchHitIsIndexedFile({ id: '1', subject: 'Fwd: doc.pdf', from: 'a@b.com', snippet: '' }),
    ).toBe(false)
  })

  it('search_index preview uses results only (ignores hints for the card)', () => {
    const json = JSON.stringify({
      results: [],
      totalMatched: 0,
      hints: ['Use a|b for alternation, not OR'],
      normalizedQuery: '(?:foo)|(?:bar)',
    })
    const prev = matchContentPreview(
      tc({
        name: 'search_index',
        args: { pattern: 'foo OR bar' },
        result: json,
      }),
    )
    expect(prev?.kind).toBe('mail_search_hits')
    if (prev?.kind !== 'mail_search_hits') return
    expect(prev.items).toEqual([])
    expect(prev.totalMatched).toBe(0)
    expect('hints' in prev).toBe(false)
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

  it('read_indexed_file uses ReadFileToolDetails for indexed-file preview', () => {
    const prev = matchContentPreview(
      tc({
        name: 'read_indexed_file',
        args: { id: 'driveFile1', source: 'my-drive' },
        details: {
          readFilePreview: true,
          id: 'driveFile1',
          title: 'Spreadsheet.csv',
          sourceKind: 'googleDrive',
          excerpt: 'col1,col2…',
        },
        result: '---\nid: driveFile1\ntitle: Spreadsheet.csv\n---\n\n# Body',
      }),
    )
    expect(prev?.kind).toBe('indexed-file')
    if (prev?.kind !== 'indexed-file') return
    expect(prev.id).toBe('driveFile1')
    expect(prev.title).toBe('Spreadsheet.csv')
    expect(prev.sourceKind).toBe('googleDrive')
    expect(prev.excerpt).toBe('col1,col2…')
    expect(prev.source).toBe('my-drive')
  })

  it('read_indexed_file prefers ## heading when details title equals id', () => {
    const prev = matchContentPreview(
      tc({
        name: 'read_indexed_file',
        args: { id: 'driveFile1' },
        details: {
          readFilePreview: true,
          id: 'driveFile1',
          title: 'driveFile1',
          sourceKind: 'unknown',
          excerpt: '## Praetor500Contract.pdf Docu sign envelop…',
        },
        result: '---',
      }),
    )
    expect(prev?.kind).toBe('indexed-file')
    if (prev?.kind !== 'indexed-file') return
    expect(prev.title).toBe('Praetor500Contract.pdf')
    expect(prev.id).toBe('driveFile1')
  })

  it('read_indexed_file markdown-only body yields preview title from ## line', () => {
    const body = '## Lease.pdf\n\nYearly rent adjustments…'
    const prev = matchContentPreview(
      tc({
        name: 'read_indexed_file',
        args: { id: 'abcDriveId' },
        result: body,
      }),
    )
    expect(prev?.kind).toBe('indexed-file')
    if (prev?.kind !== 'indexed-file') return
    expect(prev.title).toBe('Lease.pdf')
    expect(prev.id).toBe('abcDriveId')
    expect(prev.sourceKind).toBe('unknown')
  })

  it('read_indexed_file falls back to frontmatter in result when details absent', () => {
    const fm =
      '---\nid: abc\nsourceKind: localDir\ntitle: Notes.md\n---\n\nHello **world** there.'
    const prev = matchContentPreview(
      tc({
        name: 'read_indexed_file',
        args: { id: 'abc' },
        result: fm,
      }),
    )
    expect(prev?.kind).toBe('indexed-file')
    if (prev?.kind !== 'indexed-file') return
    expect(prev.id).toBe('abc')
    expect(prev.title).toBe('Notes.md')
    expect(prev.sourceKind).toBe('localDir')
    expect(prev.excerpt).toContain('Hello')
    expect(prev.excerpt).toContain('world')
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
