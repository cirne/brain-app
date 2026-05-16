import { describe, expect, it } from 'vitest'
import type { ToolCall } from '../agentUtils.js'
import {
  loadSkillToolDisplayLabel,
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

  it('returns rmdir path without wiki page extension normalization', () => {
    expect(toolSummaryPartsFromArgs('rmdir', { path: 'scratch/empty' })).toEqual({
      mode: 'single_path',
      path: 'scratch/empty',
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

  it('find_person formats query line like preview', () => {
    expect(toolSummaryPartsFromArgs('find_person', { query: 'Geof Morin' })).toEqual({
      mode: 'text',
      text: 'Query: Geof Morin',
    })
    expect(toolSummaryPartsFromArgs('find_person', {})).toEqual({
      mode: 'text',
      text: 'Top contacts (by email frequency)',
    })
  })

  it('web_search and fetch_page expose query or url', () => {
    expect(toolSummaryPartsFromArgs('web_search', { query: 'svelte' })).toEqual({
      mode: 'text',
      text: 'svelte',
    })
    expect(toolSummaryPartsFromArgs('fetch_page', { url: 'https://example.com' })).toEqual({
      mode: 'text',
      text: 'https://example.com',
    })
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

  it('uses indexed-file preview title in collapsed summary', () => {
    const tc = {
      id: 't1',
      name: 'read_indexed_file',
      args: { id: '1T_x' },
      result: '',
      done: true,
    } satisfies ToolCall
    const preview: ContentCardPreview = {
      kind: 'indexed-file',
      id: '1T_x',
      title: 'Brief.pdf',
      sourceKind: 'googleDrive',
      excerpt: '',
    }
    expect(toolCallCollapsedSummaryParts(tc, preview)).toEqual({
      mode: 'text',
      text: 'Brief.pdf',
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

  it('uses directory path for rmdir', () => {
    expect(wikiOpenPathFromArgs('rmdir', { path: 'scratch/empty' })).toBe('scratch/empty')
  })
})

describe('wikiFilePendingVerb', () => {
  it('matches seeding prefixes for write/edit', () => {
    expect(wikiFilePendingVerb('write')).toBe('Writing')
    expect(wikiFilePendingVerb('edit')).toBe('Updating')
    expect(wikiFilePendingVerb('rmdir')).toBe('Removing')
    expect(wikiFilePendingVerb('grep')).toBe(null)
  })
})

describe('loadSkillToolDisplayLabel', () => {
  it('returns null for other tools', () => {
    expect(
      loadSkillToolDisplayLabel({ id: '1', name: 'read', args: {}, done: true } satisfies ToolCall),
    ).toBe(null)
  })

  it('returns null when slug is missing', () => {
    expect(
      loadSkillToolDisplayLabel({ id: '1', name: 'load_skill', args: {}, done: false } satisfies ToolCall),
    ).toBe(null)
  })

  it('shows Loading … while in flight', () => {
    expect(
      loadSkillToolDisplayLabel({
        id: '1',
        name: 'load_skill',
        args: { slug: 'calendar' },
        done: false,
      } satisfies ToolCall),
    ).toBe('Loading Calendar…')
  })

  it('shows humanized slug when done if result has no header', () => {
    expect(
      loadSkillToolDisplayLabel({
        id: '1',
        name: 'load_skill',
        args: { slug: 'morning_report' },
        result: 'plain text',
        done: true,
      } satisfies ToolCall),
    ).toBe('Loaded Morning Report')
  })

  it('uses ## Skill: title from result when present', () => {
    const result = '## Skill: My Custom Title (`calendar`)\n\nbody'
    expect(
      loadSkillToolDisplayLabel({
        id: '1',
        name: 'load_skill',
        args: { slug: 'calendar' },
        result,
        done: true,
      } satisfies ToolCall),
    ).toBe('Loaded My Custom Title')
  })

  it('falls back to registry on error', () => {
    expect(
      loadSkillToolDisplayLabel({
        id: '1',
        name: 'load_skill',
        args: { slug: 'nope' },
        result: 'error',
        done: true,
        isError: true,
      } satisfies ToolCall),
    ).toBe(null)
  })
})
