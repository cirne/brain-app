import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiDirList from './WikiDirList.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'

describe('WikiDirList.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => [
          { path: 'ideas/note.md', name: 'note.md' },
          { path: 'me.md', name: 'me.md' },
        ],
      } as Response
    }) as typeof fetch
  })

  it('loads wiki list and navigates folder vs file', async () => {
    const onOpenFile = vi.fn()
    const onOpenDir = vi.fn()

    render(WikiDirList, {
      props: { onOpenFile, onOpenDir },
    })

    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })

    await fireEvent.click(screen.getByRole('button', { name: /ideas/i }))
    expect(onOpenDir).toHaveBeenCalledWith('ideas')

    await fireEvent.click(screen.getByRole('button', { name: /me\.md/i }))
    expect(onOpenFile).toHaveBeenCalledWith('me.md')
  })
})
