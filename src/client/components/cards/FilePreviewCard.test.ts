import { describe, it, expect, vi } from 'vitest'
import FilePreviewCard from './FilePreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('FilePreviewCard.svelte', () => {
  it('shows path, excerpt, and opens on button click', async () => {
    const onOpen = vi.fn()
    render(FilePreviewCard, {
      props: {
        path: 'notes/ideas.md',
        excerpt: 'First line of file',
        onOpen,
      },
    })

    expect(screen.getByText('notes/ideas.md')).toBeInTheDocument()
    expect(screen.getByText('First line of file')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /open file: notes\/ideas\.md/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
