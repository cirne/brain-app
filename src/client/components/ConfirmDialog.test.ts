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

    const dialog = screen.getByRole('dialog', { name: 'Remove item?' })
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveClass('cd-panel')
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('applies optional panelClass on the dialog panel', () => {
    render(ConfirmDialogHarness, {
      props: {
        open: true,
        title: 'T',
        panelClass: 'extra-panel-mod',
        onDismiss: vi.fn(),
        onConfirm: vi.fn(),
      },
    })

    expect(screen.getByRole('dialog')).toHaveClass('cd-panel', 'extra-panel-mod')
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

  it('renders custom actions instead of default buttons when `actions` snippet is passed', async () => {
    const onDismiss = vi.fn()
    const onExtra = vi.fn()
    const { container } = render(ConfirmDialogHarness, {
      props: {
        open: true,
        title: 'Token',
        onDismiss,
        onConfirm: vi.fn(),
        useCustomActions: true,
        onExtra,
      },
    })

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Extra' }))
    expect(onExtra).toHaveBeenCalledTimes(1)
    const backdrop = container.querySelector('.cd-backdrop')
    expect(backdrop).toBeTruthy()
    await fireEvent.click(backdrop!)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
