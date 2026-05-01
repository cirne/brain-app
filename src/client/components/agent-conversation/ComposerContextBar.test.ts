import { describe, it, expect, vi } from 'vitest'
import ComposerContextBar from './ComposerContextBar.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('ComposerContextBar.svelte', () => {
  it('renders nothing when files and choices are empty', () => {
    render(ComposerContextBar, {
      props: { files: [], choices: [] },
    })
    expect(screen.queryByTestId('composer-context-bar')).not.toBeInTheDocument()
  })

  it('renders doc chips and calls onOpenWiki', async () => {
    const onOpenWiki = vi.fn()
    render(ComposerContextBar, {
      props: {
        files: ['ideas/note.md'],
        choices: [],
        onOpenWiki,
      },
    })

    expect(screen.getByTestId('composer-context-bar')).toBeInTheDocument()
    const docGroup = screen.getByRole('group', { name: /referenced pages/i })
    const btn = docGroup.querySelector('button')!
    expect(btn).toBeTruthy()
    await fireEvent.click(btn)
    expect(onOpenWiki).toHaveBeenCalledWith('ideas/note.md')
  })

  it('renders action chips and calls onChoice', async () => {
    const onChoice = vi.fn()
    render(ComposerContextBar, {
      props: {
        files: [],
        choices: [{ label: 'Do it', submit: 'do the thing' }],
        onChoice,
      },
    })

    const actionGroup = screen.getByRole('group', { name: /suggested replies/i })
    const btn = actionGroup.querySelector('button')!
    expect(btn).toHaveAccessibleName(/do it/i)
    await fireEvent.click(btn)
    expect(onChoice).toHaveBeenCalledWith({ label: 'Do it', submit: 'do the thing' })
  })

  it('renders doc and action chips together without a pipe separator', () => {
    render(ComposerContextBar, {
      props: {
        files: ['a.md'],
        choices: [{ label: 'Next', submit: 'next' }],
      },
    })

    const bar = screen.getByTestId('composer-context-bar')
    expect(bar.textContent).not.toContain('|')

    const refsGroup = screen.getByRole('group', { name: /referenced pages/i })
    const actionsGroup = screen.getByRole('group', { name: /suggested replies/i })
    expect(refsGroup).toHaveClass('composer-context-bar__refs')
    expect(actionsGroup).toHaveClass('composer-context-bar__actions')

    const children = Array.from(bar.children)
    expect(children).toHaveLength(2)
    expect(children[0]).toHaveClass('composer-context-bar__refs-wrap')
    expect(children[1]).toHaveClass('composer-context-bar__actions')
  })

  it('disables action chips when choicesDisabled is true', () => {
    render(ComposerContextBar, {
      props: {
        files: [],
        choices: [{ label: 'X', submit: 'x' }],
        onChoice: vi.fn(),
        choicesDisabled: true,
      },
    })

    const actionGroup = screen.getByRole('group', { name: /suggested replies/i })
    const btn = actionGroup.querySelector('button')!
    expect(btn).toBeDisabled()
  })
})
