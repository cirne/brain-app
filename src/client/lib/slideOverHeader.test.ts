import { describe, expect, it } from 'vitest'
import type { Overlay, SurfaceContext } from '../router.js'
import {
  emailDraftTitleForSlideOver,
  emailThreadTitleForSlideOver,
  messagesTitleForSlideOver,
  titleForOverlay,
} from './slideOverHeader.js'

describe('titleForOverlay', () => {
  const cases: Array<{ overlay: Overlay; expected: string }> = [
    { overlay: { type: 'wiki' }, expected: 'Docs' },
    { overlay: { type: 'wiki-dir' }, expected: 'Docs' },
    { overlay: { type: 'file' }, expected: 'File' },
    { overlay: { type: 'email' }, expected: 'Inbox' },
    { overlay: { type: 'email-draft' }, expected: 'Draft' },
    { overlay: { type: 'mail-search' }, expected: 'Mail search' },
    { overlay: { type: 'messages' }, expected: 'Messages' },
    { overlay: { type: 'your-wiki' }, expected: 'Your Wiki' },
    { overlay: { type: 'hub-source', id: 'x' }, expected: 'Search index source' },
    { overlay: { type: 'google-account', email: 'a@b' }, expected: 'Google account' },
    { overlay: { type: 'hub-wiki-about' }, expected: 'Your wiki' },
    { overlay: { type: 'calendar' }, expected: 'Calendar' },
    { overlay: { type: 'hub' }, expected: 'Calendar' },
    { overlay: { type: 'chat-history' }, expected: 'Calendar' },
  ]

  it.each(cases)('$overlay.type → $expected', ({ overlay, expected }) => {
    expect(titleForOverlay(overlay)).toBe(expected)
  })
})

describe('emailThreadTitleForSlideOver', () => {
  const overlay: Overlay = { type: 'email', id: 't1' }
  const chat: SurfaceContext = { type: 'chat' }

  it('returns null when overlay is not email', () => {
    expect(
      emailThreadTitleForSlideOver({ type: 'wiki' }, { type: 'email', threadId: 't1', subject: 'S', from: '' }),
    ).toBeNull()
  })

  it('returns null when email overlay has no id', () => {
    expect(emailThreadTitleForSlideOver({ type: 'email' }, chat)).toBeNull()
  })

  it('returns null when surface is not email', () => {
    expect(emailThreadTitleForSlideOver(overlay, chat)).toBeNull()
  })

  it('returns null when thread id does not match', () => {
    const surface: SurfaceContext = { type: 'email', threadId: 'other', subject: 'Hi', from: '' }
    expect(emailThreadTitleForSlideOver(overlay, surface)).toBeNull()
  })

  it('returns null for loading placeholder', () => {
    const surface: SurfaceContext = { type: 'email', threadId: 't1', subject: '(loading)', from: '' }
    expect(emailThreadTitleForSlideOver(overlay, surface)).toBeNull()
  })

  it('returns null for empty subject', () => {
    const surface: SurfaceContext = { type: 'email', threadId: 't1', subject: '  ', from: '' }
    expect(emailThreadTitleForSlideOver(overlay, surface)).toBeNull()
  })

  it('returns trimmed subject when aligned', () => {
    const surface: SurfaceContext = { type: 'email', threadId: 't1', subject:  '  Hello  ', from: '' }
    expect(emailThreadTitleForSlideOver(overlay, surface)).toBe('Hello')
  })
})

describe('messagesTitleForSlideOver', () => {
  const overlay: Overlay = { type: 'messages', chat: '+15551212' }
  const emailCtx: SurfaceContext = { type: 'email', threadId: 't', subject: '', from: '' }

  it('returns null when overlay is not messages', () => {
    expect(
      messagesTitleForSlideOver(
        { type: 'email' },
        { type: 'messages', chat: '+1', displayLabel: 'A' },
      ),
    ).toBeNull()
  })

  it('returns null when messages overlay has no chat', () => {
    expect(messagesTitleForSlideOver({ type: 'messages' }, emailCtx)).toBeNull()
  })

  it('returns null when surface is not messages', () => {
    expect(messagesTitleForSlideOver(overlay, emailCtx)).toBeNull()
  })

  it('returns null when chat does not match', () => {
    const surface: SurfaceContext = { type: 'messages', chat: '+1999', displayLabel: 'Other' }
    expect(messagesTitleForSlideOver(overlay, surface)).toBeNull()
  })

  it('returns null for loading placeholder', () => {
    const surface: SurfaceContext = { type: 'messages', chat: '+15551212', displayLabel: '(loading)' }
    expect(messagesTitleForSlideOver(overlay, surface)).toBeNull()
  })

  it('returns trimmed label when aligned', () => {
    const surface: SurfaceContext = { type: 'messages', chat: '+15551212', displayLabel: '  Jane  ' }
    expect(messagesTitleForSlideOver(overlay, surface)).toBe('Jane')
  })
})

describe('emailDraftTitleForSlideOver', () => {
  const overlay: Overlay = { type: 'email-draft', id: 'd1' }
  const chat: SurfaceContext = { type: 'chat' }

  it('returns null when overlay is not email-draft', () => {
    expect(
      emailDraftTitleForSlideOver({ type: 'wiki' }, {
        type: 'email-draft',
        draftId: 'd1',
        subject: 'S',
      }),
    ).toBeNull()
  })

  it('returns null when draft overlay has no id', () => {
    expect(emailDraftTitleForSlideOver({ type: 'email-draft' }, chat)).toBeNull()
  })

  it('returns null when surface is not email-draft', () => {
    expect(emailDraftTitleForSlideOver(overlay, chat)).toBeNull()
  })

  it('returns null when draft id does not match', () => {
    const surface: SurfaceContext = {
      type: 'email-draft',
      draftId: 'other',
      subject: 'Hi',
    }
    expect(emailDraftTitleForSlideOver(overlay, surface)).toBeNull()
  })

  it('returns trimmed subject when aligned', () => {
    const surface: SurfaceContext = {
      type: 'email-draft',
      draftId: 'd1',
      subject: '  Reply — OK  ',
    }
    expect(emailDraftTitleForSlideOver(overlay, surface)).toBe('Reply — OK')
  })
})
