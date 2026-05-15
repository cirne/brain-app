import { describe, it, expect } from 'vitest'
import WikiFileName from './WikiFileName.svelte'
import { render, screen } from '@client/test/render.js'

describe('WikiFileName.svelte', () => {
  it('shows profile affordance for me.md', () => {
    render(WikiFileName, { props: { path: 'me.md' } })
    expect(screen.getByTitle('Profile (me.md)')).toBeInTheDocument()
    expect(screen.getByText('Me')).toBeInTheDocument()
  })

  it('shows My Wiki for vault root index', () => {
    render(WikiFileName, { props: { path: 'index.md' } })
    expect(screen.getByTitle('My Wiki')).toBeInTheDocument()
    expect(screen.getByText('My Wiki')).toBeInTheDocument()
  })

  it('shows index.md with folder affordance for nested folder index', () => {
    render(WikiFileName, { props: { path: 'me/index.md' } })
    expect(screen.getByTitle('me/')).toBeInTheDocument()
    expect(screen.getByText('index.md')).toBeInTheDocument()
  })

  it('shows folder icon and title-cased name for known dirs', () => {
    render(WikiFileName, { props: { path: 'ideas/some-topic.md' } })
    expect(screen.getByTitle('ideas/')).toBeInTheDocument()
    expect(screen.getByText('Some Topic')).toBeInTheDocument()
  })

  it('prefers preferredName over path-derived display', () => {
    render(WikiFileName, {
      props: { path: 'notes/a-note-file.md', preferredName: 'Board Retreat Email' },
    })
    expect(screen.getByText('Board Retreat Email')).toBeInTheDocument()
    expect(screen.queryByText('A Note File')).not.toBeInTheDocument()
  })

  it('dims text when unsaved', () => {
    const { container } = render(WikiFileName, {
      props: { path: 'notes/draft.md', unsaved: true },
    })
    expect(container.querySelector('.opacity-90')).toBeTruthy()
  })

  it('applies strip-align classes for transcript tool rows', () => {
    const { container } = render(WikiFileName, {
      props: { path: 'me.md', stripAlign: true },
    })
    const row = container.querySelector('.wfn-title-row')
    expect(row).toBeTruthy()
    expect(row).toHaveClass('min-h-0')
    expect(row?.className).toContain('[&_.wfn-name]:leading-inherit')
  })
})
