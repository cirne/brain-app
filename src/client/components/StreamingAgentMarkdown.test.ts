import { describe, it, expect } from 'vitest'
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
})
