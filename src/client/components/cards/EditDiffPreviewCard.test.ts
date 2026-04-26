import { describe, it, expect, vi } from 'vitest'
import EditDiffPreviewCard from './EditDiffPreviewCard.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('EditDiffPreviewCard.svelte', () => {
  it('shows changed diff lines and opens wiki on click', async () => {
    const onOpen = vi.fn()
    const unified = `--- a/x.md
+++ b/x.md
@@ -1,2 +1,2 @@
-old line
+new line
`
    render(EditDiffPreviewCard, {
      props: { path: 'x.md', unified, onOpen },
    })

    expect(screen.getByText('-old line')).toBeInTheDocument()
    expect(screen.getByText('+new line')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /open wiki: x\.md/i }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
