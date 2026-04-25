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
})
