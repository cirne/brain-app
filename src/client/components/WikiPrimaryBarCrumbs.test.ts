import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import WikiPrimaryBarCrumbs from './WikiPrimaryBarCrumbs.svelte'

describe('WikiPrimaryBarCrumbs.svelte', () => {
  const openPathMenu = () => screen.getByRole('button', { name: /show full path/i })

  it('maps crumbs and forwards Wiki root and folders via hierarchy menu', async () => {
    const onOpenWikiDir = vi.fn()
    render(WikiPrimaryBarCrumbs, {
      props: {
        crumbs: [
          { kind: 'wiki-root-link' },
          { kind: 'folder-link', path: 'me/travel', label: 'travel' },
          { kind: 'tail', label: 'page.md' },
        ],
        onOpenWikiDir,
      },
    })

    expect(screen.getByText('page.md').tagName).not.toBe('BUTTON')

    await fireEvent.click(openPathMenu())
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Wiki' }))
    expect(onOpenWikiDir).toHaveBeenCalledWith(undefined)

    await fireEvent.click(openPathMenu())
    await fireEvent.click(screen.getByRole('menuitem', { name: 'travel' }))
    expect(onOpenWikiDir).toHaveBeenCalledWith('me/travel')
  })
})
