import { describe, it, expect } from 'vitest'
import {
  EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP,
  EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT,
  presentationForNotificationRow,
} from './presentation.js'

describe('notification presentation', () => {
  it('exports cap and fetch limit (cap + 1)', () => {
    expect(EMPTY_CHAT_NOTIFICATION_FETCH_LIMIT).toBe(EMPTY_CHAT_NOTIFICATION_DISPLAY_CAP + 1)
  })

  it('mail_notify uses short user kickoff and puts opaque ids only in hints', () => {
    const row = presentationForNotificationRow({
      id: 'n1',
      sourceKind: 'mail_notify',
      payload: { messageId: 'mid@x', subject: 'Hello there', threadId: 't1' },
    })
    expect(row.summaryLine).toBe('Hello there')
    expect(row.kickoffUserMessage).toContain('Summarize this email')
    expect(row.kickoffUserMessage).toContain(JSON.stringify('Hello there'))
    expect(row.kickoffUserMessage).not.toContain('n1')
    expect(row.kickoffUserMessage).not.toContain('mid@x')
    expect(row.kickoffUserMessage).not.toContain('read_mail_message')
    expect(row.kickoffUserMessage).not.toContain('mark_notification')
    expect(row.kickoffHints).toEqual({
      notificationId: 'n1',
      sourceKind: 'mail_notify',
      messageId: 'mid@x',
      subject: 'Hello there',
    })
  })

  it('mail_notify falls back summary when subject empty', () => {
    const row = presentationForNotificationRow({
      id: 'n2',
      sourceKind: 'mail_notify',
      payload: { messageId: 'm2' },
    })
    expect(row.summaryLine).toBe('Email')
    expect(row.kickoffUserMessage).toBe('Summarize the email from this notification.')
    expect(row.kickoffHints.messageId).toBe('m2')
  })

  it('mail_notify without messageId still has subject in hints', () => {
    const row = presentationForNotificationRow({
      id: 'n3',
      sourceKind: 'mail_notify',
      payload: { subject: 'Only subject' },
    })
    expect(row.kickoffHints.notificationId).toBe('n3')
    expect(row.kickoffHints.subject).toBe('Only subject')
    expect(row.kickoffHints.messageId).toBeUndefined()
    expect(row.kickoffUserMessage).not.toContain('n3')
  })

  it('mail_notify prefixes summary when action required', () => {
    const row = presentationForNotificationRow({
      id: 'nar',
      sourceKind: 'mail_notify',
      payload: {
        messageId: 'mid',
        subject: 'Pay invoice',
        attention: { notify: false, actionRequired: true },
      },
    })
    expect(row.summaryLine.startsWith('Action:')).toBe(true)
    expect(row.summaryLine).toContain('Pay invoice')
    expect(row.kickoffUserMessage).toContain('follow-up')
    expect(row.kickoffHints.actionRequired).toBe(true)
  })

  it('brain_query_grant_received kickoff omits privacy preview payload text', () => {
    const row = presentationForNotificationRow({
      id: 'g1',
      sourceKind: 'brain_query_grant_received',
      payload: {
        grantId: 'bqg_x',
        ownerId: 'usr_o',
        ownerHandle: 'donna',
        privacyPolicyPreview: 'Only logistics and schedules.',
        createdAtMs: 1,
      },
    })
    expect(row.summaryLine).toContain('@donna')
    expect(row.summaryLine).toContain('sharing')
    expect(row.kickoffUserMessage).toContain('donna')
    expect(row.kickoffUserMessage).toContain('how to ask')
    expect(row.kickoffUserMessage).toContain('@donna')
    expect(row.kickoffUserMessage).not.toContain('logistics')
    expect(row.kickoffUserMessage).not.toContain('Preview')
    expect(row.kickoffUserMessage).not.toContain('Settings')
    expect(row.kickoffHints.peerHandle).toBe('donna')
    expect(row.kickoffHints.grantId).toBe('bqg_x')
    expect(row.kickoffUserMessage).not.toContain('bqg_x')
  })

  it('brain_query_inbound uses question preview and log id in hints only', () => {
    const row = presentationForNotificationRow({
      id: 'q1',
      sourceKind: 'brain_query_inbound',
      payload: {
        logId: 'bql_y',
        askerId: 'usr_a',
        questionPreview: 'What is the project status?',
        status: 'ok',
        deliveryMode: 'auto_sent',
      },
    })
    expect(row.summaryLine).toContain('Inbound query')
    expect(row.kickoffHints.logId).toBe('bql_y')
    expect(row.kickoffHints.peerUserId).toBe('usr_a')
    expect(row.kickoffHints.deliveryMode).toBe('auto_sent')
    expect(row.kickoffUserMessage).not.toContain('bql_y')
    expect(row.kickoffUserMessage).toContain('project status')
  })

  it('truncates long subject', () => {
    const long = 'a'.repeat(100)
    const row = presentationForNotificationRow({
      id: 'x',
      sourceKind: 'mail_notify',
      payload: { messageId: 'm', subject: long },
    })
    expect(row.summaryLine.length).toBeLessThanOrEqual(72)
    expect(row.summaryLine.endsWith('…')).toBe(true)
  })

  it('unknown sourceKind uses generic notification kickoff', () => {
    const row = presentationForNotificationRow({
      id: 'u1',
      sourceKind: 'custom_kind',
      payload: { foo: 1 },
    })
    expect(row.summaryLine).toContain('custom_kind')
    expect(row.kickoffUserMessage).toContain('custom_kind')
    expect(row.kickoffUserMessage).not.toContain('u1')
    expect(row.kickoffHints.notificationId).toBe('u1')
    expect(row.kickoffHints.sourceKind).toBe('custom_kind')
  })
})
