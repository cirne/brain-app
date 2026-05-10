import { describe, it, expect, vi } from 'vitest'
import EmptyChatNotificationsStrip from './EmptyChatNotificationsStrip.svelte'
import { render, fireEvent, screen, within } from '@client/test/render.js'

describe('EmptyChatNotificationsStrip.svelte', () => {
  it('brain-query grant strip summary uses i18n peer-sharing copy', () => {
    const row = {
      id: 'g1',
      sourceKind: 'brain_query_grant_received',
      summaryLine: '@donna is now sharing with you',
      kickoffUserMessage: 'kick',
      kickoffHints: { notificationId: 'g1', sourceKind: 'brain_query_grant_received', peerHandle: 'donna' },
    }
    render(EmptyChatNotificationsStrip, {
      props: {
        notifications: {
          items: [row],
          hasMore: false,
          onAct: vi.fn(),
          onDismiss: vi.fn(),
        },
      },
    })
    expect(screen.getByText('@donna is now sharing with you')).toBeInTheDocument()
  })

  it('shows rows and overflow when hasMore', () => {
    const onAct = vi.fn()
    const onDismiss = vi.fn()
    render(EmptyChatNotificationsStrip, {
      props: {
        notifications: {
          items: [
            {
              id: 'a',
              sourceKind: 'mail_notify',
              summaryLine: 'Subject A',
              kickoffUserMessage: 'kick-a',
              kickoffHints: { notificationId: 'a', sourceKind: 'mail_notify' },
            },
            {
              id: 'b',
              sourceKind: 'mail_notify',
              summaryLine: 'Subject B',
              kickoffUserMessage: 'kick-b',
              kickoffHints: { notificationId: 'b', sourceKind: 'mail_notify' },
            },
          ],
          hasMore: true,
          onAct,
          onDismiss,
        },
      },
    })

    expect(screen.getByText('Subject A')).toBeInTheDocument()
    expect(screen.getByText('Subject B')).toBeInTheDocument()
    expect(screen.getByTestId('empty-chat-notif-overflow')).toHaveTextContent(/At least one more unread/i)
  })

  it('row act calls onAct with presentation row; dismiss does not act', async () => {
    const onAct = vi.fn()
    const onDismiss = vi.fn()
    const row = {
      id: 'n1',
      sourceKind: 'mail_notify',
      summaryLine: 'Only row',
      kickoffUserMessage: 'do the thing',
      kickoffHints: { notificationId: 'n1', sourceKind: 'mail_notify', messageId: 'm1' },
    }
    render(EmptyChatNotificationsStrip, {
      props: {
        notifications: {
          items: [row],
          hasMore: false,
          onAct,
          onDismiss,
        },
      },
    })

    const strip = screen.getByTestId('empty-chat-notifications-strip')
    const rows = within(strip).getAllByTestId('empty-chat-notif-act')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    await fireEvent.click(rows[0]!)
    expect(onAct).toHaveBeenCalledWith(row)

    await fireEvent.click(within(strip).getByRole('button', { name: /dismiss notification/i }))
    expect(onDismiss).toHaveBeenCalledWith('n1')
    expect(onAct).toHaveBeenCalledTimes(1)
  })
})
