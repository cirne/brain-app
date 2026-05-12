import { describe, it, expect, vi } from 'vitest'
import ToolCallBlock from './ToolCallBlock.svelte'
import { render, screen, fireEvent } from '@client/test/render.js'
import type { ToolCall } from '@client/lib/agentUtils.js'

function makeToolCall(overrides: Partial<ToolCall>): ToolCall {
  return {
    id: 'tc-1',
    name: 'test_tool',
    args: {},
    done: false,
    ...overrides,
  }
}

describe('ToolCallBlock.svelte', () => {
  describe('pending state (!done)', () => {
    it('renders pending tool call with display name and ellipsis', () => {
      const toolCall = makeToolCall({ name: 'web_search', done: false })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.getByText('Web search…')).toBeInTheDocument()
    })

    it('renders pending read tool with verb and path', () => {
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'notes/todo.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Reading')).toBeInTheDocument()
      expect(screen.getByText('Todo')).toBeInTheDocument()
    })

    it('renders pending write tool with verb and path', () => {
      const toolCall = makeToolCall({
        name: 'write',
        args: { path: 'ideas/new-idea.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Writing')).toBeInTheDocument()
      expect(screen.getByText('New Idea')).toBeInTheDocument()
    })

    it('renders pending edit tool with verb and path', () => {
      const toolCall = makeToolCall({
        name: 'edit',
        args: { path: 'docs/readme.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Updating')).toBeInTheDocument()
      expect(screen.getByText('Readme')).toBeInTheDocument()
    })

    it('renders pending delete_file tool with verb and path', () => {
      const toolCall = makeToolCall({
        name: 'delete_file',
        args: { path: 'trash/old.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Deleting')).toBeInTheDocument()
      expect(screen.getByText('Old')).toBeInTheDocument()
    })

    it('renders pending move_file with from and to paths', () => {
      const toolCall = makeToolCall({
        name: 'move_file',
        args: { from: 'old/place.md', to: 'new/location.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Moving')).toBeInTheDocument()
      expect(screen.getByText('Place')).toBeInTheDocument()
      expect(screen.getByText('Location')).toBeInTheDocument()
      expect(screen.getByText('→')).toBeInTheDocument()
    })

    it('renders pending grep tool with pattern summary', () => {
      const toolCall = makeToolCall({
        name: 'grep',
        args: { pattern: 'TODO', path: 'notes/' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText(/Search in wiki…/)).toBeInTheDocument()
      expect(screen.getByText(/TODO · notes\//)).toBeInTheDocument()
    })

    it('renders pending find tool with pattern summary', () => {
      const toolCall = makeToolCall({
        name: 'find',
        args: { pattern: '*.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText(/Find wiki files \(glob\)…/)).toBeInTheDocument()
      expect(screen.getByText(/\*\.md/)).toBeInTheDocument()
    })

    it('clicking pending write link calls onOpenWiki', async () => {
      const onOpenWiki = vi.fn()
      const toolCall = makeToolCall({
        name: 'write',
        args: { path: 'notes/doc.md' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall, onOpenWiki } })

      const button = screen.getByRole('button')
      await fireEvent.click(button)

      expect(onOpenWiki).toHaveBeenCalledWith('notes/doc.md')
    })
  })

  describe('automation hooks (data-tool-*)', () => {
    it('sets data-tool-name, data-tool-done, data-tool-error when pending', () => {
      const toolCall = makeToolCall({ name: 'web_search', done: false })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      const part = container.querySelector('.tool-part[data-tool-name="web_search"]')
      expect(part).toBeTruthy()
      expect(part).toHaveAttribute('data-tool-done', 'false')
      expect(part).toHaveAttribute('data-tool-error', 'false')
    })

    it('sets data-tool-done true when completed', () => {
      const toolCall = makeToolCall({
        name: 'search_index',
        args: { query: 'weekly' },
        result: '{}',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      const part = container.querySelector('.tool-part[data-tool-name="search_index"]')
      expect(part).toBeTruthy()
      expect(part).toHaveAttribute('data-tool-done', 'true')
      expect(part).toHaveAttribute('data-tool-error', 'false')
    })

    it('sets data-tool-error when isError', () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        done: true,
        isError: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      const part = container.querySelector('.tool-part[data-tool-name="web_search"]')
      expect(part).toHaveAttribute('data-tool-error', 'true')
    })
  })

  describe('completed state (done)', () => {
    it('renders completed tool as compact row by default', () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: { query: 'test' },
        result: 'Found results',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-call')).toBeTruthy()
      expect(container.querySelector('details.tool-call')).toBeNull()
      expect(container.querySelector('.tool-content-preview-shell')).toBeNull()
      expect(container.querySelector('.tool-args')).toBeNull()
      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('does not render visual artifact cards in compact mode for read_mail_message', () => {
      const toolCall = makeToolCall({
        name: 'read_mail_message',
        args: { id: 'msg-1' },
        result: '{}',
        details: {
          visualArtifacts: [
            {
              kind: 'image',
              mime: 'image/png',
              ref: 'va1.embed',
              label: 'photo.png',
              origin: {
                kind: 'mailAttachment',
                messageId: 'msg-1',
                attachmentIndex: 1,
                filename: 'photo.png',
              },
              readStatus: 'available',
            },
          ],
        },
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })
      expect(container.querySelector('.tool-content-preview-shell')).toBeNull()
    })

    it('does not render visual artifact cards in compact mode for read_attachment', () => {
      const toolCall = makeToolCall({
        name: 'read_attachment',
        args: { id: 'msg-1', attachment: 'photo.png' },
        result: 'photo.png',
        details: {
          visualArtifacts: [
            {
              kind: 'image',
              mime: 'image/png',
              ref: 'va1.photo',
              label: 'photo.png',
              origin: {
                kind: 'mailAttachment',
                messageId: 'msg-1',
                attachmentIndex: 1,
                filename: 'photo.png',
              },
              readStatus: 'available',
            },
          ],
        },
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('details.tool-call')).toBeNull()
      expect(container.querySelector('.tool-content-preview-shell')).toBeNull()
    })

    it('renders visual artifact previews in compact mode only for present_visual_artifact', () => {
      const toolCall = makeToolCall({
        name: 'present_visual_artifact',
        args: { ref: 'va1.ref' },
        result: 'Showing…',
        details: {
          visualArtifacts: [
            {
              kind: 'image',
              mime: 'image/png',
              ref: 'va1.photo',
              label: 'photo.png',
              origin: {
                kind: 'mailAttachment',
                messageId: 'msg-1',
                attachmentIndex: 1,
                filename: 'photo.png',
              },
              readStatus: 'available',
            },
          ],
        },
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-content-preview-shell')).toBeTruthy()
      expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute(
        'src',
        '/api/files/artifact?ref=va1.photo',
      )
    })

    it('renders tool name in summary', () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: {},
        result: 'results',
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Web search')).toBeInTheDocument()
    })

    it('renders read tool with wiki file name in summary', () => {
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'projects/myproject.md' },
        result: '# My Project content',
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Read file')).toBeInTheDocument()
      expect(screen.getByText('Myproject')).toBeInTheDocument()
    })

    it('renders move_file with from and to paths', () => {
      const toolCall = makeToolCall({
        name: 'move_file',
        args: { from: 'old.md', to: 'new.md' },
        result: 'Moved',
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Move file')).toBeInTheDocument()
      expect(screen.getByText('Old')).toBeInTheDocument()
      expect(screen.getByText('New')).toBeInTheDocument()
      expect(screen.getByText('→')).toBeInTheDocument()
    })

    it('renders grep tool with pattern summary', () => {
      const toolCall = makeToolCall({
        name: 'grep',
        args: { pattern: 'FIXME', glob: '*.ts' },
        result: 'Found matches',
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Search in wiki')).toBeInTheDocument()
      expect(screen.getByText(/FIXME · \*\.ts/)).toBeInTheDocument()
    })

    it('shows tool args when expanded', async () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: { query: 'svelte testing' },
        result: 'results',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, displayMode: 'detailed' } })

      const details = container.querySelector('details.tool-call')
      expect(details).toBeTruthy()

      const argsElement = container.querySelector('.tool-args')
      expect(argsElement?.textContent).toContain('query')
      expect(argsElement?.textContent).toContain('svelte testing')
    })

    it('shows tool result when expanded', async () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: { query: 'test' },
        result: 'Found 3 results',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, displayMode: 'detailed' } })

      const resultElement = container.querySelector('.tool-result')
      expect(resultElement?.textContent).toContain('Found 3 results')
    })
  })

  describe('error state', () => {
    it('renders error icon for errored tool', () => {
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'missing.md' },
        result: 'File not found',
        done: true,
        isError: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, displayMode: 'detailed' } })

      const row = container.querySelector('.tool-call.error')
      expect(row).toBeTruthy()

      const iconSpan = container.querySelector('.tool-icon')
      expect(iconSpan?.textContent?.trim()).toBe('!')
    })

    it('applies error styling to result in detailed mode', () => {
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'missing.md' },
        result: 'File not found',
        done: true,
        isError: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, displayMode: 'detailed' } })

      const result = container.querySelector('.tool-result.tool-error')
      expect(result).toBeTruthy()
      expect(result?.textContent).toContain('File not found')
    })
  })

  describe('load_skill tool', () => {
    it('shows Loading label when pending', () => {
      const toolCall = makeToolCall({
        name: 'load_skill',
        args: { slug: 'ripmail' },
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Loading Ripmail……')).toBeInTheDocument()
    })

    it('shows Loaded label when complete', () => {
      const toolCall = makeToolCall({
        name: 'load_skill',
        args: { slug: 'morning-report' },
        result: '## Skill: Morning Report (`morning-report`)\n...',
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Loaded Morning Report')).toBeInTheDocument()
    })
  })

  describe('tool icons', () => {
    it('renders icon for known tools', () => {
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'test.md' },
        result: 'content',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      const iconSpan = container.querySelector('.tool-icon svg')
      expect(iconSpan).toBeTruthy()
    })

    it('renders fallback SVG for unknown tools', () => {
      const toolCall = makeToolCall({
        name: 'custom_unknown_tool',
        args: {},
        result: 'done',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      const svg = container.querySelector('.tool-icon svg')
      expect(svg).toBeTruthy()
    })
  })

  describe('callback handlers', () => {
    it('clicking compact wiki preview opens the wiki document', async () => {
      const onOpenWiki = vi.fn()
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'notes/test.md' },
        result: '# Test content here',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, onOpenWiki } })

      expect(container.querySelector('.tool-content-preview-shell')).toBeNull()
      await fireEvent.click(screen.getByRole('button', { name: /open read file/i }))
      expect(onOpenWiki).toHaveBeenCalledWith('notes/test.md')
    })

    it('clicking compact email preview opens the email thread', async () => {
      const onOpenEmail = vi.fn()
      const toolCall = makeToolCall({
        name: 'read_mail_message',
        args: { id: 'msg-123' },
        result: JSON.stringify({
          subject: 'Test Subject',
          from: 'sender@example.com',
          bodyText: 'Email body content',
        }),
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, onOpenEmail } })

      expect(container.querySelector('.tool-content-preview-shell')).toBeNull()
      await fireEvent.click(screen.getByRole('button', { name: /open read mail/i }))
      expect(onOpenEmail).toHaveBeenCalledWith('msg-123', 'Test Subject', 'sender@example.com')
    })

    it('clicking compact calendar preview opens calendar', async () => {
      const onSwitchToCalendar = vi.fn()
      const toolCall = makeToolCall({
        name: 'calendar',
        args: { start: '2024-01-01', end: '2024-01-07' },
        result: JSON.stringify([
          { id: 'e1', title: 'Meeting', start: '2024-01-02T10:00:00' },
        ]),
        done: true,
      })
      const { container } = render(ToolCallBlock, {
        props: { toolCall, onSwitchToCalendar },
      })

      expect(container.querySelector('.tool-content-preview-shell')).toBeNull()
      await fireEvent.click(screen.getByRole('button', { name: /open calendar/i }))
      expect(onSwitchToCalendar).toHaveBeenCalledWith('2024-01-02', 'e1')
    })

    it('clicking compact mail search opens the search results drill-down', async () => {
      const onOpenMailSearchResults = vi.fn()
      const toolCall = makeToolCall({
        id: 'tool-search-1',
        name: 'search_index',
        args: { pattern: 'invoice' },
        result: JSON.stringify({
          results: [{ messageId: 'msg-1', subject: 'Invoice', fromAddress: 'a@example.com' }],
          totalMatched: 1,
        }),
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall, onOpenMailSearchResults } })

      await fireEvent.click(screen.getByRole('button', { name: /open search index/i }))

      expect(onOpenMailSearchResults).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'mail_search_hits' }),
        'tool-search-1',
      )
    })
  })

  describe('result display conditions', () => {
    it('hides result for wiki_edit_diff preview kind', () => {
      const toolCall = makeToolCall({
        name: 'edit',
        args: { path: 'test.md' },
        result: 'File edited',
        details: {
          editDiff: {
            path: 'test.md',
            unified: '@@ -1 +1 @@\n-old\n+new',
          },
        },
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, displayMode: 'detailed' } })

      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('shows muted result when preview exists', () => {
      const toolCall = makeToolCall({
        name: 'read',
        args: { path: 'test.md' },
        result: 'File content here',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, displayMode: 'detailed' } })

      const result = container.querySelector('.tool-result.muted')
      expect(result).toBeTruthy()
    })
  })

  describe('edge cases', () => {
    it('uses tool name as fallback when no display label exists', () => {
      const toolCall = makeToolCall({
        name: 'unknown_custom_tool',
        args: {},
        result: 'done',
        done: true,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Unknown Custom Tool')).toBeInTheDocument()
    })

    it('handles empty result gracefully', () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: { query: 'test' },
        result: '',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-call')).toBeTruthy()
      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('handles undefined args gracefully', () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: undefined as any,
        result: 'results',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-call')).toBeTruthy()
    })

    it('renders list_inbox tool with inbox label', () => {
      const toolCall = makeToolCall({
        name: 'list_inbox',
        args: {},
        done: false,
      })
      render(ToolCallBlock, { props: { toolCall } })

      expect(screen.getByText('Inbox…')).toBeInTheDocument()
    })

    it('renders calendar tool with label', () => {
      const toolCall = makeToolCall({
        name: 'get_calendar_events',
        args: { start: '2024-01-01', end: '2024-01-07' },
        done: false,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      const pendingElement = container.querySelector('.tool-pending')
      expect(pendingElement).toBeTruthy()
    })

    it('renders find_person tool', () => {
      const toolCall = makeToolCall({
        name: 'find_person',
        args: { query: 'John' },
        result: JSON.stringify({ people: [{ name: 'John Doe', email: 'john@example.com' }] }),
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-call')).toBeTruthy()
    })

    it('renders search_index tool with query', () => {
      const toolCall = makeToolCall({
        name: 'search_index',
        args: { query: 'invoice' },
        result: JSON.stringify({ results: [], totalMatched: 0 }),
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-call')).toBeTruthy()
    })

    it('handles tool without result', () => {
      const toolCall = makeToolCall({
        name: 'web_search',
        args: { query: 'test' },
        result: undefined,
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('hides result for message_thread preview kind', () => {
      const toolCall = makeToolCall({
        name: 'get_message_thread',
        args: { chat_identifier: '+1234567890' },
        result: 'messages...',
        details: {
          messageThreadPreview: true,
          canonical_chat: '+1234567890',
          chat: 'John',
          preview_messages: [],
        },
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('hides result for find_person_hits preview kind', () => {
      const toolCall = makeToolCall({
        name: 'find_person',
        args: { query: 'test' },
        result: 'Name: John\nEmail: john@example.com',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('hides result for mail_search_hits preview kind', () => {
      const toolCall = makeToolCall({
        name: 'search_index',
        args: { query: 'test' },
        result: JSON.stringify({ results: [], totalMatched: 0 }),
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('hides result for feedback_draft preview kind', () => {
      const toolCall = makeToolCall({
        name: 'product_feedback',
        args: { op: 'draft', feedback: 'Test feedback' },
        result: 'Feedback draft (show this to the user; do not save until they confirm):\n\n# Bug Report\n\nTest',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall } })

      expect(container.querySelector('.tool-result')).toBeNull()
    })

    it('hides result for email_draft preview and Open calls onOpenDraft', async () => {
      const onOpenDraft = vi.fn()
      const toolCall = makeToolCall({
        name: 'draft_email',
        args: {},
        details: { id: 'draft-x', subject: 'Hi there', body: 'Hello world text here' },
        result: '{"id":"draft-x"}',
        done: true,
      })
      const { container } = render(ToolCallBlock, { props: { toolCall, onOpenDraft } })

      expect(container.querySelector('.tool-result')).toBeNull()

      await fireEvent.click(screen.getByRole('button', { name: /open draft email/i }))
      expect(onOpenDraft).toHaveBeenCalledWith('draft-x', 'Hi there')
    })
  })
})
