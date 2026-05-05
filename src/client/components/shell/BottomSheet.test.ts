import { describe, it, expect, vi } from 'vitest'
import BottomSheetHarness from '@components/test-stubs/BottomSheetHarness.svelte'
import { render, screen, fireEvent } from '@client/test/render.js'

describe('BottomSheet.svelte', () => {
  it('renders title and snippet body when open', () => {
    render(BottomSheetHarness, {
      props: {
        open: true,
        title: 'More',
        onDismiss: vi.fn(),
      },
    })
    expect(screen.getByRole('heading', { name: 'More' })).toBeInTheDocument()
    expect(screen.getByText('Inside sheet')).toBeInTheDocument()
  })

  it('calls onDismiss when backdrop is clicked', async () => {
    const onDismiss = vi.fn()
    render(BottomSheetHarness, {
      props: {
        open: true,
        title: 'Sheet',
        onDismiss,
      },
    })
    const backdrop = document.querySelector('.bs-backdrop')
    expect(backdrop).toBeTruthy()
    await fireEvent.click(backdrop!)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
