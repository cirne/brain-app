import { describe, it, expect, vi } from 'vitest'
import ConversationEmptyState from '@tw-components/agent-conversation/ConversationEmptyState.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('tw-components ConversationEmptyState.svelte', () => {
  it('renders onboarding copy', () => {
    render(ConversationEmptyState, { props: {} })

    expect(
      screen.getByText(/Ask anything about your docs, email, or calendar/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/your wiki/i)).toBeInTheDocument()
  })

  it('renders wiki about link when onOpenWikiAbout is provided', async () => {
    const onOpenWikiAbout = vi.fn()
    render(ConversationEmptyState, { props: { onOpenWikiAbout } })

    await fireEvent.click(screen.getByRole('button', { name: /your wiki/i }))
    expect(onOpenWikiAbout).toHaveBeenCalledTimes(1)
  })
})
