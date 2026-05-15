import { describe, it, expect, vi } from 'vitest'
import {
  enrichNotificationKickoffFromDb,
  mergeNotificationKickoffPromptMessages,
  notificationKickoffAppContextText,
  parseNotificationKickoffFromBody,
} from './notificationKickoffPrompt.js'
import * as resolvePrivacy from '@server/lib/brainQuery/resolveGrantPrivacyInstructions.js'
import * as brainQueryGrantsRepo from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import * as notificationsRepo from '@server/lib/notifications/notificationsRepo.js'

const kickoffTestGrant = {
  id: 'bqg_0123456789abcdef01234567',
  owner_id: 'usr_o',
  asker_id: 'usr_a',
  preset_policy_key: 'general' as const,
  custom_policy_id: null,
  reply_mode: 'review' as const,
  created_at_ms: 0,
  updated_at_ms: 0,
  revoked_at_ms: null,
}

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

  it('parseNotificationKickoffFromBody extracts question', () => {
    expect(
      parseNotificationKickoffFromBody({
        notificationKickoff: {
          notificationId: 'n',
          sourceKind: 'brain_query_question',
          question: '  What is the status?  ',
        },
      }),
    ).toEqual({
      notificationId: 'n',
      sourceKind: 'brain_query_question',
      question: 'What is the status?',
    })
  })

  it('enrichNotificationKickoffFromDb loads brain_query_question from tenant row', () => {
    const spy = vi.spyOn(notificationsRepo, 'getNotificationById').mockReturnValue({
      id: 'n-db',
      sourceKind: 'brain_query_question',
      payload: {
        grantId: 'bqg_0123456789abcdef01234567',
        peerUserId: 'usr_a',
        peerHandle: 'pat',
        peerPrimaryEmail: 'pat@example.com',
        question: 'What is the ETA for the release?',
        subject: 'What is the ETA for the release?',
      },
      state: 'unread',
      idempotencyKey: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    })
    try {
      const h = enrichNotificationKickoffFromDb({
        notificationId: 'n-db',
        sourceKind: 'brain_query_question',
      })
      expect(h.question).toBe('What is the ETA for the release?')
      expect(h.grantId).toBe('bqg_0123456789abcdef01234567')
      expect(h.peerPrimaryEmail).toBe('pat@example.com')
      expect(h.peerHandle).toBe('pat')
    } finally {
      spy.mockRestore()
    }
  })

  it('enrichNotificationKickoffFromDb loads brain_query_reply_sent from tenant row', () => {
    const spy = vi.spyOn(notificationsRepo, 'getNotificationById').mockReturnValue({
      id: 'n-rs',
      sourceKind: 'brain_query_reply_sent',
      payload: {
        grantId: 'bqg_0123456789abcdef01234567',
        peerUserId: 'usr_owner',
        peerHandle: 'donna',
        subject: 'Re: [braintunnel] ETA',
      },
      state: 'unread',
      idempotencyKey: 'k',
      createdAtMs: 1,
      updatedAtMs: 1,
    })
    try {
      const h = enrichNotificationKickoffFromDb({
        notificationId: 'n-rs',
        sourceKind: 'brain_query_reply_sent',
      })
      expect(h.subject).toBe('Re: [braintunnel] ETA')
      expect(h.grantId).toBe('bqg_0123456789abcdef01234567')
      expect(h.peerHandle).toBe('donna')
    } finally {
      spy.mockRestore()
    }
  })

  it('enrichNotificationKickoffFromDb is a no-op for other kinds', () => {
    const spy = vi.spyOn(notificationsRepo, 'getNotificationById')
    try {
      const h = { notificationId: 'n1', sourceKind: 'mail_notify' as const, messageId: 'm1' }
      expect(enrichNotificationKickoffFromDb(h)).toEqual(h)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
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

  it('notificationKickoffAppContextText for brain_query_question uses draft_email new not read_mail', () => {
    const spy = vi.spyOn(brainQueryGrantsRepo, 'getBrainQueryGrantById').mockReturnValue(kickoffTestGrant)
    const resSpy = vi.spyOn(resolvePrivacy, 'resolveGrantPrivacyInstructions').mockReturnValue('Replies: facts only.')
    try {
      const t = notificationKickoffAppContextText({
        notificationId: 'n1',
        sourceKind: 'brain_query_question',
        grantId: 'bqg_0123456789abcdef01234567',
        peerPrimaryEmail: 'asker@example.com',
        peerHandle: 'pat',
        question: 'Ship date for Q2?',
      })
      expect(t).toContain('in-app notification')
      expect(t).toContain('Ship date for Q2?')
      expect(t).toContain('action=new')
      expect(t).toContain('b2b_query')
      expect(t).toContain('send_draft')
      expect(t).toContain('Grant policy')
      expect(t).toContain('facts only')
      expect(t).not.toContain('read_mail_message')
    } finally {
      spy.mockRestore()
      resSpy.mockRestore()
    }
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

  it('notificationKickoffAppContextText for brain_query_reply_sent steers to refresh_sources then inbox', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'brain_query_reply_sent',
      peerHandle: 'donna',
      grantId: 'bqg_0123456789abcdef01234567',
      subject: 'Re: [braintunnel] Status',
    })
    expect(t).toContain('refresh_sources')
    expect(t).toContain('search_index')
    expect(t).toContain('45000')
    expect(t).not.toContain('draft_email')
    expect(t).not.toContain('send_draft')
  })

  it('notificationKickoffAppContextText for brain_query_mail injects grant privacy_policy when present', () => {
    const spy = vi.spyOn(brainQueryGrantsRepo, 'getBrainQueryGrantById').mockReturnValue(kickoffTestGrant)
    const resSpy = vi.spyOn(resolvePrivacy, 'resolveGrantPrivacyInstructions').mockReturnValue('Keep logistics only.')
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
      resSpy.mockRestore()
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
