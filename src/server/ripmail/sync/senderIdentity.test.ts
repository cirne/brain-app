import { describe, it, expect } from 'vitest'

import { nameDerivedEmailLocals, pickIndexedFromFields } from './senderIdentity.js'

describe('nameDerivedEmailLocals', () => {
  it('includes first-initial + last for two-word names', () => {
    const s = nameDerivedEmailLocals('Alan Finley')
    expect(s.has('afinley')).toBe(true)
    expect(s.has('alan.finley')).toBe(true)
  })
})

describe('pickIndexedFromFields', () => {
  it('prefers same-domain Reply-To when it matches display name over a technical From local part', () => {
    const r = pickIndexedFromFields(
      {
        value: [{ name: 'Alan Finley', address: '2aqeh@greenlonghorninc.com' }],
      },
      {
        replyTo: { value: [{ address: 'afinley@greenlonghorninc.com' }] },
      },
    )
    expect(r.fromAddress).toBe('afinley@greenlonghorninc.com')
    expect(r.fromName).toBe('Alan Finley')
  })

  it('prefers a second From address on the same row when it matches the display name', () => {
    const r = pickIndexedFromFields({
      value: [
        { name: 'Alan Finley', address: '2aqeh@greenlonghorninc.com' },
        { address: 'afinley@greenlonghorninc.com' },
      ],
    })
    expect(r.fromAddress).toBe('afinley@greenlonghorninc.com')
    expect(r.fromName).toBe('Alan Finley')
  })

  it('ignores Reply-To on a different domain', () => {
    const r = pickIndexedFromFields(
      {
        value: [{ name: 'Alan Finley', address: '2aqeh@greenlonghorninc.com' }],
      },
      {
        replyTo: { value: [{ address: 'afinley@other.example' }] },
      },
    )
    expect(r.fromAddress).toBe('2aqeh@greenlonghorninc.com')
  })

  it('does not swap Reply-To when it is not clearly better than From', () => {
    const r = pickIndexedFromFields(
      {
        value: [{ name: 'Bob', address: 'bob@corp.example' }],
      },
      {
        replyTo: { value: [{ address: 'other@corp.example' }] },
      },
    )
    expect(r.fromAddress).toBe('bob@corp.example')
  })

  it('prefers an unambiguous To address when it matches the display name and Reply-To is absent', () => {
    const r = pickIndexedFromFields(
      {
        value: [{ name: 'Alan Finley', address: '2aqeh@greenlonghorninc.com' }],
      },
      {
        toAddresses: ['afinley@greenlonghorninc.com', 'teammate@example.com'],
      },
    )
    expect(r.fromAddress).toBe('afinley@greenlonghorninc.com')
    expect(r.fromName).toBe('Alan Finley')
  })

  it('does not use To when two same-domain addresses match derived locals', () => {
    const r = pickIndexedFromFields(
      {
        value: [{ name: 'Pat Smith', address: 'x12@acme.test' }],
      },
      {
        toAddresses: ['pat@acme.test', 'pat.smith@acme.test'],
      },
    )
    expect(r.fromAddress).toBe('x12@acme.test')
  })

  it('considers Sender when same domain and stronger than From', () => {
    const r = pickIndexedFromFields(
      {
        value: [{ name: 'Alan Finley', address: '2aqeh@greenlonghorninc.com' }],
      },
      {
        sender: { value: [{ address: 'afinley@greenlonghorninc.com' }] },
      },
    )
    expect(r.fromAddress).toBe('afinley@greenlonghorninc.com')
  })
})
