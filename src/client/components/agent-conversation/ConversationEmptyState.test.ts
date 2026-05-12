import { describe, it, expect, vi } from 'vitest'
import ConversationEmptyState from './ConversationEmptyState.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'

describe('ConversationEmptyState.svelte', () => {
  it('renders tunnel outbound copy with workspace @mention', () => {
    render(ConversationEmptyState, {
      props: {
        tunnelOutboundEmptyChat: true,
        tunnelOutboundPeer: '@ken',
      },
    })

    expect(screen.getByText(/Messaging @ken through a tunnel/i)).toBeInTheDocument()
    expect(screen.getByText(/They answer from their Brain/i)).toBeInTheDocument()
    expect(screen.queryByText(/your wiki/i)).not.toBeInTheDocument()
  })

  it('renders anonymous tunnel copy when peer mention is missing', () => {
    render(ConversationEmptyState, {
      props: { tunnelOutboundEmptyChat: true, tunnelOutboundPeer: null },
    })

    expect(screen.getByText(/Messaging another Brain through a tunnel/i)).toBeInTheDocument()
    expect(screen.queryByText(/@ken/i)).not.toBeInTheDocument()
  })

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
