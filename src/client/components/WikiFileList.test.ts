import { describe, it, expect, vi } from 'vitest'
import WikiFileList from './WikiFileList.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('WikiFileList.svelte', () => {
  it('lists unsaved and recent files and opens on mousedown', async () => {
    const onOpen = vi.fn()
    render(WikiFileList, {
      props: {
        dirty: ['notes/todo.md'],
        recent: [{ path: 'ideas/x.md', date: '2026-04-01' }],
        onOpen,
        formatDate: () => 'Apr 1',
      },
    })

    expect(screen.getByText('Unsaved')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()

    const unsavedBtn = screen.getByRole('button', { name: /todo/i })
    await fireEvent.mouseDown(unsavedBtn)
    expect(onOpen).toHaveBeenLastCalledWith('notes/todo.md')

    const recentBtn = screen.getByRole('button', { name: /x/i })
    await fireEvent.mouseDown(recentBtn)
    expect(onOpen).toHaveBeenLastCalledWith('ideas/x.md')
  })
})
