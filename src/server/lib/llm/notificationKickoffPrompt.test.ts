import { describe, it, expect } from 'vitest'
import {
  mergeNotificationKickoffPromptMessages,
  notificationKickoffAppContextText,
  parseNotificationKickoffFromBody,
} from './notificationKickoffPrompt.js'

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
          sourceKind: 'brain_query_inbound',
          logId: ' L1 ',
          peerUserId: ' usr_a ',
          questionPreview: ' Hi? ',
          deliveryMode: 'auto_sent',
        },
      }),
    ).toEqual({
      notificationId: 'n',
      sourceKind: 'brain_query_inbound',
      logId: 'L1',
      peerUserId: 'usr_a',
      questionPreview: 'Hi?',
      deliveryMode: 'auto_sent',
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

  it('notificationKickoffAppContextText for inbound brain-query skips read_mail_message instructions', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'brain_query_inbound',
      logId: 'log_z',
      questionPreview: 'status?',
      peerUserId: 'usr_x',
      deliveryMode: 'auto_sent',
    })
    expect(t).toContain('inbound brain-query')
    expect(t).toContain('log_z')
    expect(t).toContain('Do **not** use **read_mail_message**')
    expect(t).toContain('Do **not** call **mark_notification**')
  })

  it('notificationKickoffAppContextText for brain_query_grant_received emphasizes how to ask sharer via @ mention', () => {
    const t = notificationKickoffAppContextText({
      notificationId: 'n1',
      sourceKind: 'brain_query_grant_received',
      grantId: 'g1',
      peerHandle: 'donna',
    })
    expect(t).toContain('how to ask')
    expect(t).toContain('`@donna`')
    expect(t).toContain('ask_brain')
    expect(t).toContain('agent-diagnostics')
    expect(t).toContain('Do **not** default')
    expect(t).not.toContain('Settings → Sharing')
    expect(t).not.toContain('trusted confidant')
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
