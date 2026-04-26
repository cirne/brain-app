import { describe, it, expect, vi } from 'vitest'
import WikiPreviewCard from './WikiPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('WikiPreviewCard.svelte', () => {
  it('invokes onOpen when the preview is activated', async () => {
    const onOpen = vi.fn()
    render(WikiPreviewCard, {
      props: {
        path: 'ideas/plan.md',
        excerpt: '---\ntitle: Plan\n---\n\nBody **bold**',
        onOpen,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: /open doc: ideas\/plan\.md/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
