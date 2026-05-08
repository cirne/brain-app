import { describe, it, expect, vi, beforeEach } from 'vitest'
import WikiDirList from './WikiDirList.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'
import { createWikiSlideHeaderContext } from '@client/test/helpers/index.js'

describe('WikiDirList.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          files: [
            { path: 'ideas/note.md', name: 'note' },
            { path: 'me.md', name: 'me' },
          ],
        }),
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

    await fireEvent.click(screen.getByRole('button', { name: /^me$/i }))
    expect(onOpenFile).toHaveBeenCalledWith('me.md')
  })

  it('claims the wiki slide header cell with stable handler refs', async () => {
    const { context, cell, ref } = createWikiSlideHeaderContext()

    const onContextChange = vi.fn()
    const { rerender } = render(WikiDirList, {
      props: {
        dirPath: 'trips',
        onOpenFile: vi.fn(),
        onOpenDir: vi.fn(),
        onContextChange,
      },
      context,
    } as unknown as Parameters<typeof render>[1])

    await waitFor(() => {
      expect(ref.current).not.toBeNull()
    })

    expect(cell.claimed).toBe(true)
    expect(ref.current?.canEdit).toBe(false)
    const setPageModeRef = ref.current?.setPageMode
    expect(typeof setPageModeRef).toBe('function')

    const onContextChange2 = vi.fn()
    rerender({
      dirPath: 'trips',
      onOpenFile: vi.fn(),
      onOpenDir: vi.fn(),
      onContextChange: onContextChange2,
    })

    await waitFor(() => {
      expect(cell.claimed).toBe(true)
    })
    expect(ref.current?.setPageMode).toBe(setPageModeRef)
  })
})
