import { describe, it, expect, vi } from 'vitest'
import ConfirmDialogHarness from './test-stubs/ConfirmDialogHarness.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('ConfirmDialog.svelte', () => {
  it('renders title and body when open', () => {
    const onDismiss = vi.fn()
    const onConfirm = vi.fn()
    render(ConfirmDialogHarness, {
      props: {
        open: true,
        title: 'Remove item?',
        onDismiss,
        onConfirm,
        bodyText: 'This cannot be undone.',
      },
    })

    expect(screen.getByRole('dialog', { name: 'Remove item?' })).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(ConfirmDialogHarness, {
      props: {
        open: false,
        title: 'Nope',
        onDismiss: vi.fn(),
        onConfirm: vi.fn(),
      },
    })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls onDismiss for Cancel and backdrop click', async () => {
    const onDismiss = vi.fn()
    const onConfirm = vi.fn()

    render(ConfirmDialogHarness, {
      props: {
        open: true,
        title: 'T',
        cancelLabel: 'No thanks',
        onDismiss,
        onConfirm,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'No thanks' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)

    onDismiss.mockClear()
    const backdrop = document.querySelector('.cd-backdrop')
    expect(backdrop).toBeTruthy()
    await fireEvent.click(backdrop!)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('calls onConfirm when confirm is clicked', async () => {
    const onConfirm = vi.fn()
    render(ConfirmDialogHarness, {
      props: {
        open: true,
        title: 'T',
        confirmLabel: 'Do it',
        onDismiss: vi.fn(),
        onConfirm,
      },
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Do it' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on Escape', async () => {
    const onDismiss = vi.fn()
    render(ConfirmDialogHarness, {
      props: {
        open: true,
        title: 'T',
        onDismiss,
        onConfirm: vi.fn(),
      },
    })

    await fireEvent.keyDown(window, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalled()
  })
})
