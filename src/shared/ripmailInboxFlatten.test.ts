import { describe, it, expect } from 'vitest'
import {
  flattenInboxFromRipmailData,
  formatEmailParticipant,
  parseRipmailInboxFlat,
} from './ripmailInboxFlatten.js'

describe('ripmailInboxFlatten', () => {
  it('formatEmailParticipant formats name + address objects', () => {
    expect(formatEmailParticipant({ name: 'Kirsten Vliet', address: 'k@example.com' })).toBe(
      'Kirsten Vliet <k@example.com>',
    )
    expect(formatEmailParticipant('plain@example.com')).toBe('plain@example.com')
  })

  it('flattenInboxFromRipmailData returns null for non-objects', () => {
    expect(flattenInboxFromRipmailData(null)).toBeNull()
    expect(flattenInboxFromRipmailData([])).toBeNull()
  })

  it('parseRipmailInboxFlat skips ignored items', () => {
    const rows = parseRipmailInboxFlat(
      JSON.stringify({
        mailboxes: [
          {
            items: [
              {
                messageId: 'a',
                subject: 'X',
                fromName: 'A',
                action: 'ignore',
              },
              {
                messageId: 'b',
                subject: 'Y',
                fromName: 'B',
                action: 'read',
              },
            ],
          },
        ],
      }),
    )
    expect(rows).toHaveLength(1)
    expect(rows![0].id).toBe('b')
    expect(rows![0].read).toBe(true)
  })

  it('marks notify action as unread', () => {
    const rows = parseRipmailInboxFlat(
      JSON.stringify({
        mailboxes: [
          {
            items: [
              {
                messageId: 'n',
                subject: 'Ping',
                fromName: 'Bot',
                action: 'notify',
              },
            ],
          },
        ],
      }),
    )
    expect(rows![0].read).toBe(false)
  })

  it('sorts rows newest-first by date (across mailboxes)', () => {
    const rows = parseRipmailInboxFlat(
      JSON.stringify({
        mailboxes: [
          {
            items: [
              {
                messageId: 'older',
                subject: 'Old',
                fromName: 'A',
                date: '2026-04-27T10:00:00Z',
                action: 'read',
              },
              {
                messageId: 'newer',
                subject: 'New',
                fromName: 'B',
                date: '2026-04-28T15:30:00Z',
                action: 'read',
              },
            ],
          },
          {
            items: [
              {
                messageId: 'mid',
                subject: 'Mid',
                fromName: 'C',
                date: '2026-04-28T08:00:00Z',
                action: 'read',
              },
            ],
          },
        ],
      }),
    )
    expect(rows?.map((r) => r.id)).toEqual(['newer', 'mid', 'older'])
  })

  it('places missing or invalid dates after dated messages', () => {
    const rows = flattenInboxFromRipmailData({
      mailboxes: [
        {
          items: [
            {
              messageId: 'no-date',
              subject: 'X',
              fromName: 'A',
              action: 'read',
            },
            {
              messageId: 'bad-date',
              subject: 'Y',
              fromName: 'B',
              date: 'not-a-date',
              action: 'read',
            },
            {
              messageId: 'dated',
              subject: 'Z',
              fromName: 'C',
              date: '2026-04-28T12:00:00Z',
              action: 'read',
            },
          ],
        },
      ],
    })
    expect(rows?.map((r) => r.id)).toEqual(['dated', 'no-date', 'bad-date'])
  })
})
