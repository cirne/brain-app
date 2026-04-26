import { describe, it, expect, vi } from 'vitest'
import ReferencedFilesStrip from './ReferencedFilesStrip.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('ReferencedFilesStrip.svelte', () => {
  it('renders a chip per path and calls onOpenWiki', async () => {
    const onOpenWiki = vi.fn()
    render(ReferencedFilesStrip, {
      props: {
        paths: ['ideas/note.md', 'me.md'],
        onOpenWiki,
      },
    })

    expect(screen.getByText('Referenced')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)

    await fireEvent.click(buttons[0]!)
    expect(onOpenWiki).toHaveBeenCalledWith('ideas/note.md')

    await fireEvent.click(buttons[1]!)
    expect(onOpenWiki).toHaveBeenCalledWith('me.md')
  })
})
