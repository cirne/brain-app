import { describe, it, expect } from 'vitest'
import { tick } from 'svelte'
import StreamingAgentMarkdown from './agent-conversation/StreamingAgentMarkdown.svelte'
import { render, screen } from '@client/test/render.js'

describe('StreamingAgentMarkdown.svelte', () => {
  it('renders markdown as HTML', () => {
    const { container } = render(StreamingAgentMarkdown, {
      props: { content: 'Hello **world**', class: 'test-md' },
    })

    const root = container.querySelector('.streaming-agent-md.test-md')
    expect(root).toBeTruthy()
    expect(root?.innerHTML).toMatch(/strong|b>/i)
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('mounts WikiFileName into assistant wiki link placeholders', async () => {
    const { container } = render(StreamingAgentMarkdown, {
      props: {
        content: 'Opened [source file](travel/2026-07-west-coast-canada/canada.md).',
      },
    })

    await tick()

    const chip = container.querySelector('[data-brain-wiki-chip][data-wiki]')
    expect(chip).toBeTruthy()
    expect(chip?.getAttribute('data-wiki')).toBe('travel/2026-07-west-coast-canada/canada.md')
    expect(chip?.querySelector('.wfn-title-row')).toBeTruthy()
    expect(chip?.textContent).toContain('Canada')
    expect(container.querySelector('code')).toBeNull()
  })

  it('replaces mounted WikiFileName chips when content changes', async () => {
    const { container, rerender } = render(StreamingAgentMarkdown, {
      props: { content: 'Opened [old](travel/old-page.md).' },
    })

    await tick()
    expect(container.querySelector('[data-wiki="travel/old-page.md"] .wfn-title-row')).toBeTruthy()

    await rerender({ content: 'Opened [new](travel/new-page.md).' })
    await tick()

    expect(container.querySelector('[data-wiki="travel/old-page.md"]')).toBeNull()
    expect(container.querySelector('[data-wiki="travel/new-page.md"] .wfn-title-row')).toBeTruthy()
    expect(container.textContent).toContain('New Page')
  })
})
