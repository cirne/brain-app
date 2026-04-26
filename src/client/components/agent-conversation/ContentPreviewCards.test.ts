import { describe, it, expect, vi, beforeEach } from 'vitest'
import ContentPreviewCards from './ContentPreviewCards.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'
import type {
  ContentCardPreview,
  CalendarEventLite,
  MessagePreviewRow,
  InboxListItemPreview,
  MailSearchHitPreview,
} from '@client/lib/cards/contentCards.js'

function makeCalendarEvent(overrides: Partial<CalendarEventLite> = {}): CalendarEventLite {
  return {
    id: 'evt-1',
    title: 'Test Event',
    start: '2099-01-15T10:00:00',
    end: '2099-01-15T11:00:00',
    allDay: false,
    source: 'test',
    ...overrides,
  }
}

function makeMessagePreview(overrides: Partial<MessagePreviewRow> = {}): MessagePreviewRow {
  return {
    sent_at_unix: 1_700_000_000,
    is_from_me: false,
    text: 'Hello',
    ...overrides,
  }
}

function makeInboxItem(overrides: Partial<InboxListItemPreview> = {}): InboxListItemPreview {
  return {
    id: 'mail-1',
    subject: 'Test Subject',
    from: 'sender@example.com',
    snippet: 'Preview snippet',
    date: '2026-04-01',
    ...overrides,
  }
}

function makeMailSearchHit(overrides: Partial<MailSearchHitPreview> = {}): MailSearchHitPreview {
  return {
    id: 'hit-1',
    subject: 'Search Result',
    from: 'found@example.com',
    snippet: 'Matching text...',
    ...overrides,
  }
}

describe('ContentPreviewCards.svelte', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response) as typeof fetch
  })

  describe('calendar preview', () => {
    it('renders CalendarPreviewCard and calls onSwitchToCalendar', async () => {
      const onSwitchToCalendar = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'calendar',
        start: '2099-02-01',
        end: '2099-02-01',
        events: [],
      }

      render(ContentPreviewCards, { props: { preview, onSwitchToCalendar } })

      expect(screen.getByText('2099-02-01')).toBeInTheDocument()
      await fireEvent.click(screen.getByRole('button', { name: /open calendar/i }))
      expect(onSwitchToCalendar).toHaveBeenCalledWith('2099-02-01')
    })

    it('renders events when provided', () => {
      const preview: ContentCardPreview = {
        kind: 'calendar',
        start: '2099-01-15',
        end: '2099-01-15',
        events: [makeCalendarEvent({ title: 'Morning Standup' })],
      }

      render(ContentPreviewCards, { props: { preview } })

      expect(screen.getByText('Morning Standup')).toBeInTheDocument()
    })

    it('calls onSwitchToCalendar with event id when clicking an event', async () => {
      const onSwitchToCalendar = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'calendar',
        start: '2099-01-15',
        end: '2099-01-15',
        events: [makeCalendarEvent({ id: 'evt-123', title: 'Team Meeting' })],
      }

      render(ContentPreviewCards, { props: { preview, onSwitchToCalendar } })

      await fireEvent.click(screen.getByRole('button', { name: /open team meeting in calendar/i }))
      expect(onSwitchToCalendar).toHaveBeenCalledWith('2099-01-15', 'evt-123')
    })
  })

  describe('wiki preview', () => {
    it('renders WikiPreviewCard and calls onOpenWiki', async () => {
      const onOpenWiki = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'wiki',
        path: 'notes/test.md',
        excerpt: '# Test Document\n\nSome content here.',
      }

      render(ContentPreviewCards, { props: { preview, onOpenWiki } })

      await fireEvent.click(screen.getByRole('button', { name: /open doc: notes\/test\.md/i }))
      expect(onOpenWiki).toHaveBeenCalledWith('notes/test.md')
    })
  })

  describe('file preview', () => {
    it('renders FilePreviewCard and calls onOpenFile', async () => {
      const onOpenFile = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'file',
        path: '/Users/me/docs/report.pdf',
        excerpt: 'File content excerpt',
      }

      render(ContentPreviewCards, { props: { preview, onOpenFile } })

      expect(screen.getByText('/Users/me/docs/report.pdf')).toBeInTheDocument()
      expect(screen.getByText('File content excerpt')).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /open file/i }))
      expect(onOpenFile).toHaveBeenCalledWith('/Users/me/docs/report.pdf')
    })
  })

  describe('email preview', () => {
    it('renders EmailPreviewCard and calls onOpenEmail', async () => {
      const onOpenEmail = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'email',
        id: 'thread-123',
        subject: 'Re: Project Update',
        from: 'boss@company.com',
        snippet: 'Please review the attached...',
      }

      render(ContentPreviewCards, { props: { preview, onOpenEmail } })

      expect(screen.getByText('Re: Project Update')).toBeInTheDocument()
      expect(screen.getByText('boss@company.com')).toBeInTheDocument()
      expect(screen.getByText('Please review the attached...')).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /open email thread/i }))
      expect(onOpenEmail).toHaveBeenCalledWith('thread-123', 'Re: Project Update', 'boss@company.com')
    })
  })

  describe('inbox_list preview', () => {
    it('renders InboxListPreviewCard and calls onOpenEmail', async () => {
      const onOpenEmail = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'inbox_list',
        items: [makeInboxItem({ id: 'mail-42', subject: 'Hello World', from: 'friend@mail.com' })],
        totalCount: 1,
      }

      render(ContentPreviewCards, { props: { preview, onOpenEmail } })

      expect(screen.getByText(/1 message/)).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /open: hello world/i }))
      expect(onOpenEmail).toHaveBeenCalledWith('mail-42', 'Hello World', 'friend@mail.com')
    })

    it('calls onOpenFullInbox from the footer', async () => {
      const onOpenFullInbox = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'inbox_list',
        items: [makeInboxItem()],
        totalCount: 5,
      }

      render(ContentPreviewCards, { props: { preview, onOpenFullInbox } })

      await fireEvent.click(screen.getByRole('button', { name: /show full inbox/i }))
      expect(onOpenFullInbox).toHaveBeenCalledTimes(1)
    })
  })

  describe('message_thread preview', () => {
    it('renders MessageThreadPreviewCard and calls onOpenMessageThread', async () => {
      const onOpenMessageThread = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'message_thread',
        displayChat: 'Mom',
        canonicalChat: '+15551234567',
        snippet: 'Call me when you can',
        total: 100,
        returnedCount: 5,
        previewMessages: [makeMessagePreview({ text: 'Hey there' })],
        person: ['Mom'],
      }

      render(ContentPreviewCards, { props: { preview, onOpenMessageThread } })

      expect(screen.getAllByText('Mom').length).toBeGreaterThan(0)
      expect(screen.getByText('Call me when you can')).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /open message thread: mom/i }))
      expect(onOpenMessageThread).toHaveBeenCalledWith('+15551234567', 'Mom')
    })
  })

  describe('wiki_edit_diff preview', () => {
    it('renders EditDiffPreviewCard and calls onOpenWiki', async () => {
      const onOpenWiki = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'wiki_edit_diff',
        path: 'docs/readme.md',
        unified: `--- a/docs/readme.md
+++ b/docs/readme.md
@@ -1,2 +1,2 @@
-Old content
+New content
`,
      }

      render(ContentPreviewCards, { props: { preview, onOpenWiki } })

      expect(screen.getByText('-Old content')).toBeInTheDocument()
      expect(screen.getByText('+New content')).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /open wiki/i }))
      expect(onOpenWiki).toHaveBeenCalledWith('docs/readme.md')
    })
  })

  describe('mail_search_hits preview', () => {
    it('renders MailSearchHitsPreviewCard and calls onOpenEmail', async () => {
      const onOpenEmail = vi.fn()
      const preview: ContentCardPreview = {
        kind: 'mail_search_hits',
        queryLine: 'from:ceo@company.com',
        items: [makeMailSearchHit({ id: 'hit-99', subject: 'Important Update', from: 'ceo@company.com' })],
        totalMatched: 5,
      }

      render(ContentPreviewCards, { props: { preview, onOpenEmail } })

      expect(screen.getByText('from:ceo@company.com')).toBeInTheDocument()
      expect(screen.getByText('Important Update')).toBeInTheDocument()

      await fireEvent.click(screen.getByRole('button', { name: /important update/i }))
      expect(onOpenEmail).toHaveBeenCalledWith('hit-99', 'Important Update', 'ceo@company.com')
    })
  })

  describe('find_person_hits preview', () => {
    it('renders FindPersonHitsPreviewCard with people', () => {
      const preview: ContentCardPreview = {
        kind: 'find_person_hits',
        queryLine: 'john',
        people: [
          { name: 'John Doe', email: 'john@example.com' },
          { name: 'Johnny Appleseed' },
        ],
      }

      render(ContentPreviewCards, { props: { preview } })

      expect(screen.getByText('john')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('john@example.com')).toBeInTheDocument()
      expect(screen.getByText('Johnny Appleseed')).toBeInTheDocument()
    })
  })

  describe('feedback_draft preview', () => {
    it('renders FeedbackDraftPreviewCard with markdown', () => {
      const preview: ContentCardPreview = {
        kind: 'feedback_draft',
        markdown: `Please add dark mode support.`,
      }

      render(ContentPreviewCards, { props: { preview } })

      expect(screen.getByRole('region', { name: /feedback draft/i })).toBeInTheDocument()
      expect(screen.getByText(/dark mode/i)).toBeInTheDocument()
    })
  })

  describe('missing callbacks', () => {
    it('does not crash when onSwitchToCalendar is undefined', async () => {
      const preview: ContentCardPreview = {
        kind: 'calendar',
        start: '2099-01-01',
        end: '2099-01-01',
        events: [],
      }

      render(ContentPreviewCards, { props: { preview } })

      await fireEvent.click(screen.getByRole('button', { name: /open calendar/i }))
    })

    it('does not crash when onOpenWiki is undefined', async () => {
      const preview: ContentCardPreview = {
        kind: 'wiki',
        path: 'test.md',
        excerpt: 'Content',
      }

      render(ContentPreviewCards, { props: { preview } })

      await fireEvent.click(screen.getByRole('button', { name: /open doc/i }))
    })

    it('does not crash when onOpenFile is undefined', async () => {
      const preview: ContentCardPreview = {
        kind: 'file',
        path: '/path/to/file.txt',
        excerpt: 'Content',
      }

      render(ContentPreviewCards, { props: { preview } })

      await fireEvent.click(screen.getByRole('button', { name: /open file/i }))
    })

    it('does not crash when onOpenEmail is undefined', async () => {
      const preview: ContentCardPreview = {
        kind: 'email',
        id: 'id-1',
        subject: 'Test',
        from: 'a@b.com',
        snippet: 'Hi',
      }

      render(ContentPreviewCards, { props: { preview } })

      await fireEvent.click(screen.getByRole('button', { name: /open email/i }))
    })

    it('does not crash when onOpenMessageThread is undefined', async () => {
      const preview: ContentCardPreview = {
        kind: 'message_thread',
        displayChat: 'Contact',
        canonicalChat: '+1234',
        snippet: 'Hi',
        total: 1,
        returnedCount: 1,
        previewMessages: [],
        person: ['Contact'],
      }

      render(ContentPreviewCards, { props: { preview } })

      await fireEvent.click(screen.getByRole('button', { name: /open message thread/i }))
    })
  })
})
