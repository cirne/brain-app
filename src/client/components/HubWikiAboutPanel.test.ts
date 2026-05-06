import { describe, it, expect } from 'vitest'
import HubWikiAboutPanel from './HubWikiAboutPanel.svelte'
import { render, screen } from '@client/test/render.js'

describe('HubWikiAboutPanel.svelte', () => {
  it('explains the vault wiki and the continuous loop', () => {
    const { container } = render(HubWikiAboutPanel)

    expect(
      container.querySelector('.hub-wiki-about-lead')?.textContent ?? '',
    ).toMatch(/private set of Markdown pages/i)
    expect(screen.getByRole('heading', { name: /How automatic updates work/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Sources vs\. wiki/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /You're in control/i })).toBeInTheDocument()
  })
})
