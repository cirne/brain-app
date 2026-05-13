import { describe, expect, it, vi, afterEach } from 'vitest'
import { tick } from 'svelte'
import { render, screen, fireEvent, waitFor } from '@client/test/render.js'
import { createMockFetch, jsonResponse } from '@client/test/mocks/fetch.js'
import SaveTunnelToWikiModal from './SaveTunnelToWikiModal.svelte'
import type { ChatMessage } from '@client/lib/agentUtils.js'

describe('SaveTunnelToWikiModal.svelte', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts markdown to POST /api/wiki on save', async () => {
    const wikiPost = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { path: string }
      return jsonResponse({ ok: true, path: body.path })
    })
    vi.stubGlobal(
      'fetch',
      createMockFetch([
        {
          match: (u: string, init?: RequestInit) => u === '/api/wiki' && init?.method === 'POST',
          response: wikiPost,
        },
      ]),
    )

    const onDismiss = vi.fn()
    const onNavigateWiki = vi.fn()
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]

    render(SaveTunnelToWikiModal, {
      props: {
        open: true,
        onDismiss,
        messages,
        peerLabel: 'donna',
        sessionId: 'sess-1',
        onNavigateWiki,
      },
    })

    await waitFor(() => expect(screen.getByTestId('save-tunnel-wiki-modal')).toBeInTheDocument())

    const pathInput = screen.getByTestId('save-tunnel-wiki-path') as HTMLInputElement
    await fireEvent.input(pathInput, { target: { value: 'tunnels/donna/custom.md' } })
    await tick()

    await fireEvent.click(screen.getByTestId('save-tunnel-wiki-submit'))

    await waitFor(() => expect(wikiPost).toHaveBeenCalled())
    const init = wikiPost.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body)) as { path: string; markdown: string }
    expect(body.path).toBe('tunnels/donna/custom.md')
    expect(body.markdown).toContain('## You')
    expect(body.markdown).toContain('Hello')
    expect(body.markdown).toContain('## Assistant')
    expect(body.markdown).toContain('Hi there')
    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
    expect(onNavigateWiki).toHaveBeenCalledWith('tunnels/donna/custom.md')
  })
})
