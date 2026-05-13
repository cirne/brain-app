import { describe, expect, it, vi } from 'vitest'
import {
  chatMessagePlainText,
  defaultWikiPath,
  messagesToMarkdown,
  normalizeWikiPathSegment,
  saveToWiki,
} from './saveTunnelToWiki.js'
import type { ChatMessage } from '@client/lib/agentUtils.js'

vi.mock('@client/lib/apiFetch.js', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from '@client/lib/apiFetch.js'

describe('saveTunnelToWiki', () => {
  describe('normalizeWikiPathSegment', () => {
    it('kebabs and lowercases', () => {
      expect(normalizeWikiPathSegment('My Big Idea')).toBe('my-big-idea')
    })
    it('throws on empty', () => {
      expect(() => normalizeWikiPathSegment('   ')).toThrow('empty after normalization')
    })
  })

  describe('chatMessagePlainText', () => {
    it('prefers text parts over content', () => {
      const msg: ChatMessage = {
        role: 'assistant',
        content: 'ignored',
        parts: [{ type: 'text', content: '  hello  ' }],
      }
      expect(chatMessagePlainText(msg)).toBe('hello')
    })
    it('falls back to content', () => {
      const msg: ChatMessage = { role: 'user', content: 'hey' }
      expect(chatMessagePlainText(msg)).toBe('hey')
    })
  })

  describe('messagesToMarkdown', () => {
    it('builds sections and provenance by default', () => {
      const msgs: ChatMessage[] = [
        { role: 'user', content: 'Ping?' },
        { role: 'assistant', content: 'Pong.' },
      ]
      const md = messagesToMarkdown(msgs, {
        title: 'Test note',
        peerLabel: '@donna',
        sessionId: 'sess-1',
        dateYmd: '2026-05-12',
      })
      expect(md).toContain('# Test note')
      expect(md).toContain('## You')
      expect(md).toContain('Ping?')
      expect(md).toContain('## Assistant')
      expect(md).toContain('Pong.')
      expect(md).toContain('> From tunnel with @donna · 2026-05-12 · session sess-1')
    })
    it('omits provenance when disabled', () => {
      const md = messagesToMarkdown([{ role: 'assistant', content: 'Hi' }], {
        includeProvenance: false,
        peerLabel: 'alex',
        sessionId: 'x',
      })
      expect(md).not.toContain('From tunnel with')
    })
  })

  describe('defaultWikiPath', () => {
    it('uses peer, date, and slug from first line', () => {
      const p = defaultWikiPath({
        peerLabel: 'Donna',
        sessionId: 's',
        firstLine: 'Status update for Q2',
        now: new Date(2026, 4, 12),
      })
      expect(p).toBe('tunnels/donna/2026-05-12-status-update-for-q2.md')
    })
    it('falls back when first line normalizes empty', () => {
      const p = defaultWikiPath({
        peerLabel: 'x',
        sessionId: 's',
        firstLine: '---',
        now: new Date(2026, 4, 12),
      })
      expect(p).toMatch(/^tunnels\/x\/2026-05-12-message\.md$/)
    })
    it('uses tunnel slug when no first line', () => {
      const p = defaultWikiPath({
        peerLabel: '@peer',
        sessionId: 's',
        now: new Date(2026, 0, 2),
      })
      expect(p).toBe('tunnels/peer/2026-01-02-tunnel.md')
    })
  })

  describe('saveToWiki', () => {
    it('returns path on success', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, path: 'notes/x.md' }), { status: 200 }),
      )
      const r = await saveToWiki({ path: 'notes/x.md', markdown: '# Hi' })
      expect(r.path).toBe('notes/x.md')
      expect(apiFetch).toHaveBeenCalledWith('/api/wiki', expect.objectContaining({ method: 'POST' }))
    })
    it('throws on error body', async () => {
      vi.mocked(apiFetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Already exists' }), { status: 409 }),
      )
      await expect(saveToWiki({ path: 'x.md', markdown: '' })).rejects.toThrow('Already exists')
    })
  })
})
