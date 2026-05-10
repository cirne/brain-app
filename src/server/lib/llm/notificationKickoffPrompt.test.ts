import { describe, it, expect, vi } from 'vitest'
import {
  mergeNotificationKickoffPromptMessages,
  notificationKickoffAppContextText,
  parseNotificationKickoffFromBody,
} from './notificationKickoffPrompt.js'
import * as brainQueryGrantsRepo from '@server/lib/brainQuery/brainQueryGrantsRepo.js'

describe('notificationKickoffPrompt', () => {
  it('parseNotificationKickoffFromBody extracts hints', () => {
    expect(
      parseNotificationKickoffFromBody({
        notificationKickoff: {
          notificationId: ' nid ',
          sourceKind: ' mail_notify ',
          messageId: ' mid ',
          subject: ' Sub ',
        },
      }),
    ).toEqual({
      notificationId: 'nid',
      sourceKind: 'mail_notify',
      messageId: 'mid',
      subject: 'Sub',
    })
  })

  it('parseNotificationKickoffFromBody rejects invalid shapes', () => {
    expect(parseNotificationKickoffFromBody({})).toBeNull()
    expect(parseNotificationKickoffFromBody({ notificationKickoff: [] })).toBeNull()
    expect(parseNotificationKickoffFromBody({ notificationKickoff: { notificationId: '', sourceKind: 'x' } })).toBeNull()
  })

  it('parseNotificationKickoffFromBody extracts extended hints', () => {
    expect(
      parseNotificationKickoffFromBody({
        notificationKickoff: {
          notificationId: 'n',
          sourceKind: 'brain_query_mail',
          peerUserId: ' usr_a ',
          grantId: ' g1 ',
          peerHandle: ' pat ',
        },
      }),
    ).toEqual({
      notificationId: 'n',
      sourceKind: 'brain_query_mail',
      peerUserId: 'usr_a',
      grantId: 'g1',
      peerHandle: 'pat',
    })
  })

  it('parseNotificationKickoffFromBody extracts actionRequired', () => {
    expect(
      parseNotificationKickoffFromBody({
        notificationKickoff: {
          notificationId: 'n',
          sourceKind: 'mail_notify',
          actionRequired: true,
        },
      }),
    ).toEqual({
      notificationId: 'n',
      sourceKind: 'mail_notify',
      actionRequired: true,
    })
  })

  it('parseNotificationKickoffFromBody extracts peerPrimaryEmail', () => {
    expect(
      parseNotificationKickoffFromBody({
        notificationKickoff: {
          notificationId: 'n',
          sourceKind: 'brain_query_mail',
          peerPrimaryEmail: '  a@b.co  ',
        },
      }),
    ).toEqual({
      notificationId: 'n',
      sourceKind: 'brain_query_mail',
      peerPrimaryEmail: 'a@b.co',
    })
  })

  it('notificationKickoffAppContextText for brain_query_grant_received steers to ask_collaborator', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'brain_query_grant_received',
      grantId: 'g1',
      peerHandle: 'donna',
    })
    expect(t).toContain('ask_collaborator')
    expect(t).toContain('inbox_rules')
    expect(t).toContain('[braintunnel]')
    expect(t).not.toContain('draft_email')
    expect(t).not.toContain('ask_' + 'brain')
    expect(t).toContain('**@donna**')
    expect(t).toContain('Do **not** default')
    expect(t).not.toContain('Settings → Sharing')
    expect(t).not.toContain('trusted confidant')
  })

  it('notificationKickoffAppContextText for brain_query_mail routes to mail tools', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'brain_query_mail',
      messageId: 'mid@x',
      subject: '[braintunnel] hi',
      grantId: 'bqg_0123456789abcdef01234567',
    })
    expect(t).toContain('shared-brain')
    expect(t).toContain('read_mail_message')
    expect(t).toContain('b2b_query')
    expect(t).toContain('send_draft')
  })

  it('notificationKickoffAppContextText for brain_query_mail injects grant privacy_policy when present', () => {
    const spy = vi.spyOn(brainQueryGrantsRepo, 'getBrainQueryGrantById').mockReturnValue({
      id: 'bqg_0123456789abcdef01234567',
      owner_id: 'usr_o',
      asker_id: 'usr_a',
      privacy_policy: 'Keep logistics only.',
      created_at_ms: 0,
      updated_at_ms: 0,
      revoked_at_ms: null,
    })
    try {
      const t = notificationKickoffAppContextText({
        notificationId: 'n1',
        sourceKind: 'brain_query_mail',
        grantId: 'bqg_0123456789abcdef01234567',
        messageId: 'm1',
      })
      expect(t).toContain('Grant policy')
      expect(t).toContain('Keep logistics only.')
    } finally {
      spy.mockRestore()
    }
  })

  it('notificationKickoffAppContextText references tools without encouraging default mark_notification', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'mail_notify',
      messageId: 'mid@x',
    })
    expect(t).toContain('read_mail_message')
    expect(t).toContain('mid@x')
    expect(t).toContain('mark_notification')
    expect(t).toContain('Do **not** call **mark_notification**')
  })

  it('notificationKickoffAppContextText uses mail-style default for unregistered source_kind', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'some_future_notification_kind',
      messageId: 'mid@y',
    })
    expect(t).toContain('read_mail_message')
    expect(t).toContain('mid@y')
  })

  it('mergeNotificationKickoffPromptMessages prepends notification context before user text', () => {
    const msgs = mergeNotificationKickoffPromptMessages('Hello', {
      notificationId: 'n1',
      sourceKind: 'mail_notify',
    })
    expect(msgs.length).toBe(2)
    expect(msgs[0]?.role).toBe('user')
    const headBlock = msgs[0] as { content?: Array<{ type: string; text?: string }> }
    expect(headBlock.content?.[0]?.text ?? '').toContain('[App — notification queue item]')
    expect(msgs[1]?.role).toBe('user')
    const secondBlock = msgs[1] as { content?: Array<{ type: string; text?: string }> }
    expect(secondBlock.content?.[0]?.text ?? '').toBe('Hello')
  })
})
