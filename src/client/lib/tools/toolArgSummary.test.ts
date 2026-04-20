import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../agentUtils.js'
import {
  toolCallCollapsedSummaryParts,
  toolCallSummaryPartsFromTool,
  toolSummaryPartsFromArgs,
  wikiFilePendingVerb,
  wikiOpenPathFromArgs,
  wikiToolPathForSeeding,
} from './toolArgSummary.js'
import type { ContentCardPreview } from '../cards/contentCardShared.js'

describe('toolSummaryPartsFromArgs', () => {
  it('normalizes wiki path for edit', () => {
    expect(toolSummaryPartsFromArgs('edit', { path: 'people/jane' })).toEqual({
      mode: 'single_path',
      path: 'people/jane.md',
    })
  })

  it('returns move pair with normalized paths', () => {
    expect(
      toolSummaryPartsFromArgs('move_file', { from: 'a.md', to: 'folder/b' }),
    ).toEqual({
      mode: 'move',
      from: 'a.md',
      to: 'folder/b.md',
    })
  })

  it('grep shows pattern and optional scope', () => {
    expect(toolSummaryPartsFromArgs('grep', { pattern: 'foo', path: 'people' })).toEqual({
      mode: 'text',
      text: 'foo · people',
    })
    expect(toolSummaryPartsFromArgs('grep', { pattern: 'bar', glob: '*.md' })).toEqual({
      mode: 'text',
      text: 'bar · *.md',
    })
  })

  it('find shows pattern and optional path', () => {
    expect(toolSummaryPartsFromArgs('find', { pattern: '**/*.md' })).toEqual({
      mode: 'text',
      text: '**/*.md',
    })
    expect(toolSummaryPartsFromArgs('find', { pattern: '*.md', path: 'ideas' })).toEqual({
      mode: 'text',
      text: '*.md · ideas',
    })
  })

  it('truncates very long grep patterns', () => {
    const long = 'x'.repeat(100)
    const r = toolSummaryPartsFromArgs('grep', { pattern: long })
    expect(r?.mode).toBe('text')
    if (r?.mode === 'text') {
      expect(r.text.length).toBeLessThanOrEqual(73)
      expect(r.text.endsWith('…')).toBe(true)
    }
  })
})

describe('toolCallCollapsedSummaryParts', () => {
  it('prefers wiki preview path over raw args', () => {
    const tc = {
      id: '1',
      name: 'read',
      args: { path: 'me' },
      result: 'hello',
      done: true,
    } satisfies ToolCall
    const preview: ContentCardPreview = {
      kind: 'wiki',
      path: 'me.md',
      excerpt: 'hello',
    }
    expect(toolCallCollapsedSummaryParts(tc, preview)).toEqual({
      mode: 'single_path',
      path: 'me.md',
    })
  })

  it('falls back to args when preview missing', () => {
    const tc = {
      id: '1',
      name: 'grep',
      args: { pattern: 'x' },
      result: '',
      done: true,
    } satisfies ToolCall
    expect(toolCallCollapsedSummaryParts(tc, null)).toEqual({
      mode: 'text',
      text: 'x',
    })
  })
})

describe('toolCallSummaryPartsFromTool', () => {
  it('integrates matchContentPreview for completed tools', () => {
    const tc = {
      id: '1',
      name: 'write',
      args: { path: 'x.md', content: 'body text here' },
      result: '',
      done: true,
    } satisfies ToolCall
    const parts = toolCallSummaryPartsFromTool(tc)
    expect(parts?.mode).toBe('single_path')
    if (parts?.mode === 'single_path') {
      expect(parts.path).toBe('x.md')
    }
  })
})

describe('wikiToolPathForSeeding', () => {
  it('normalizes path like previews', () => {
    expect(wikiToolPathForSeeding({ path: 'people/jane' })).toBe('people/jane.md')
  })
})

describe('wikiOpenPathFromArgs', () => {
  it('uses destination for move_file', () => {
    expect(wikiOpenPathFromArgs('move_file', { from: 'a.md', to: 'b' })).toBe('b.md')
  })
})

describe('wikiFilePendingVerb', () => {
  it('matches seeding prefixes for write/edit', () => {
    expect(wikiFilePendingVerb('write')).toBe('Writing')
    expect(wikiFilePendingVerb('edit')).toBe('Updating')
    expect(wikiFilePendingVerb('grep')).toBe(null)
  })
})
