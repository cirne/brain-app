import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { tick } from 'svelte'
import AgentConversation from './AgentConversation.svelte'
import { render, screen, fireEvent } from '@client/test/render.js'
import type { ChatMessage } from '@client/lib/agentUtils.js'

vi.mock('./ChatMessageRow.svelte', () => import('../test-stubs/ChatMessageRowStub.svelte'))
vi.mock('./ConversationEmptyState.svelte', () => import('../test-stubs/ConversationEmptyStateStub.svelte'))
vi.mock('./ReferencedFilesStrip.svelte', () => import('../test-stubs/ReferencedFilesStripStub.svelte'))
vi.mock('./CalendarDatePopover.svelte', () => import('../test-stubs/CalendarDatePopoverStub.svelte'))

if (typeof Element.prototype.animate !== 'function') {
  Element.prototype.animate = vi.fn(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    reverse: vi.fn(),
    finish: vi.fn(),
    onfinish: null,
    oncancel: null,
    currentTime: 0,
    playState: 'finished',
    effect: null,
    timeline: null,
    id: '',
    pending: false,
    playbackRate: 1,
    startTime: 0,
    commitStyles: vi.fn(),
    persist: vi.fn(),
    updatePlaybackRate: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    replaceState: vi.fn(),
  })) as unknown as typeof Element.prototype.animate
}

function createUserMessage(content: string): ChatMessage {
  return { role: 'user', content }
}

function createAssistantMessage(content: string, parts?: ChatMessage['parts']): ChatMessage {
  return {
    role: 'assistant',
    content,
    parts: parts ?? [{ type: 'text', content }],
  }
}

function createAssistantMessageWithWikiTool(
  content: string,
  wikiPath: string,
): ChatMessage {
  return {
    role: 'assistant',
    content,
    parts: [
      {
        type: 'tool',
        toolCall: {
          id: 'tc-1',
          name: 'read_wiki',
          args: { path: wikiPath },
          result: 'ok',
          done: true,
        },
      },
      { type: 'text', content },
    ],
  }
}

describe('AgentConversation.svelte', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('empty state', () => {
    it('renders ConversationEmptyState when messages array is empty', () => {
      render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      expect(screen.getByTestId('conversation-empty-state')).toBeInTheDocument()
    })

    it('sets data-conversation-state to empty when no messages', () => {
      render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      const shell = document.querySelector('[data-conversation-state]')
      expect(shell).toHaveAttribute('data-conversation-state', 'empty')
    })

    it('sets data-conversation-state to active when messages exist', () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      const shell = document.querySelector('[data-conversation-state]')
      expect(shell).toHaveAttribute('data-conversation-state', 'active')
    })

    it('does not render empty state when messages exist', () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      expect(screen.queryByTestId('conversation-empty-state')).not.toBeInTheDocument()
    })
  })

  describe('message rendering', () => {
    it('renders user messages', () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello there')],
          streaming: false,
        },
      })

      const row = screen.getByTestId('chat-message-row')
      expect(row).toHaveAttribute('data-role', 'user')
      expect(row).toHaveTextContent('Hello there')
    })

    it('renders assistant messages', () => {
      render(AgentConversation, {
        props: {
          messages: [createAssistantMessage('Hi! How can I help?')],
          streaming: false,
        },
      })

      const row = screen.getByTestId('chat-message-row')
      expect(row).toHaveAttribute('data-role', 'assistant')
      expect(row).toHaveTextContent('Hi! How can I help?')
    })

    it('renders multiple messages in order', () => {
      render(AgentConversation, {
        props: {
          messages: [
            createUserMessage('First'),
            createAssistantMessage('Second'),
            createUserMessage('Third'),
          ],
          streaming: false,
        },
      })

      const rows = screen.getAllByTestId('chat-message-row')
      expect(rows).toHaveLength(3)
      expect(rows[0]).toHaveAttribute('data-role', 'user')
      expect(rows[1]).toHaveAttribute('data-role', 'assistant')
      expect(rows[2]).toHaveAttribute('data-role', 'user')
    })

    it('marks last message correctly', () => {
      render(AgentConversation, {
        props: {
          messages: [
            createUserMessage('First'),
            createAssistantMessage('Second'),
          ],
          streaming: false,
        },
      })

      const rows = screen.getAllByTestId('chat-message-row')
      expect(rows[0]).toHaveAttribute('data-last-message', 'false')
      expect(rows[1]).toHaveAttribute('data-last-message', 'true')
    })

    it('marks last assistant in thread correctly', () => {
      render(AgentConversation, {
        props: {
          messages: [
            createUserMessage('First'),
            createAssistantMessage('Second'),
            createUserMessage('Third'),
            createAssistantMessage('Fourth'),
          ],
          streaming: false,
        },
      })

      const rows = screen.getAllByTestId('chat-message-row')
      expect(rows[1]).toHaveAttribute('data-last-assistant', 'false')
      expect(rows[3]).toHaveAttribute('data-last-assistant', 'true')
    })
  })

  describe('referenced files strip', () => {
    it('does not render when no referenced files', () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      expect(screen.queryByTestId('referenced-files-strip')).not.toBeInTheDocument()
    })

    it('renders when assistant message has wiki tool calls', () => {
      render(AgentConversation, {
        props: {
          messages: [createAssistantMessageWithWikiTool('Done', 'notes/test.md')],
          streaming: false,
        },
      })

      const strip = screen.getByTestId('referenced-files-strip')
      expect(strip).toHaveAttribute('data-paths', 'notes/test.md')
    })

    it('extracts wiki links from markdown content', () => {
      const msg: ChatMessage = {
        role: 'assistant',
        content: 'Check [this page](wiki:docs/readme.md)',
        parts: [{ type: 'text', content: 'Check [this page](wiki:docs/readme.md)' }],
      }

      render(AgentConversation, {
        props: {
          messages: [msg],
          streaming: false,
        },
      })

      const strip = screen.getByTestId('referenced-files-strip')
      expect(strip).toHaveAttribute('data-paths', 'docs/readme.md')
    })
  })

  describe('jump to latest button', () => {
    it('does not show jump button when followOutput is true (default)', () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      expect(screen.queryByRole('button', { name: /jump to latest/i })).not.toBeInTheDocument()
    })

    it('shows jump button when user scrolls away from bottom', async () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      const scrollEl = document.querySelector('.conversation')!
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(scrollEl, 'scrollTop', { value: 0, configurable: true })
      Object.defineProperty(scrollEl, 'clientHeight', { value: 300, configurable: true })

      await fireEvent.scroll(scrollEl)
      await tick()

      expect(screen.getByRole('button', { name: /jump to latest/i })).toBeInTheDocument()
    })

    it('shows streaming indicator in button when streaming', async () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: true,
        },
      })

      const scrollEl = document.querySelector('.conversation')!
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(scrollEl, 'scrollTop', { value: 0, configurable: true })
      Object.defineProperty(scrollEl, 'clientHeight', { value: 300, configurable: true })

      await fireEvent.scroll(scrollEl)
      await tick()

      const jumpBtn = screen.getByRole('button', { name: /reply in progress/i })
      expect(jumpBtn).toHaveClass('streaming')
    })

    it('clicking jump button scrolls to bottom', async () => {
      render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      const scrollEl = document.querySelector('.conversation')!
      Object.defineProperty(scrollEl, 'scrollHeight', { value: 1000, configurable: true })
      Object.defineProperty(scrollEl, 'scrollTop', { value: 0, writable: true, configurable: true })
      Object.defineProperty(scrollEl, 'clientHeight', { value: 300, configurable: true })

      await fireEvent.scroll(scrollEl)
      await tick()

      const jumpBtn = screen.getByRole('button', { name: /jump to latest/i })
      await fireEvent.click(jumpBtn)

      vi.runAllTimers()
      await tick()
    })
  })

  describe('scroll behavior', () => {
    it('exposes scrollToBottom method', () => {
      const { component } = render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      expect(typeof component.scrollToBottom).toBe('function')
    })

    it('exposes scrollToBottomIfFollowing method', () => {
      const { component } = render(AgentConversation, {
        props: {
          messages: [createUserMessage('Hello')],
          streaming: false,
        },
      })

      expect(typeof component.scrollToBottomIfFollowing).toBe('function')
    })
  })

  describe('click handlers', () => {
    it('calls onSwitchToCalendar when clicking data-date element', async () => {
      const onSwitchToCalendar = vi.fn()

      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
          onSwitchToCalendar,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const dateBtn = document.createElement('button')
      dateBtn.setAttribute('data-date', '2024-03-15')
      dateBtn.textContent = 'March 15'
      conversation.appendChild(dateBtn)

      await fireEvent.click(dateBtn)

      expect(onSwitchToCalendar).toHaveBeenCalledWith('2024-03-15')
    })

    it('calls onOpenWiki when clicking data-wiki element', async () => {
      const onOpenWiki = vi.fn()

      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
          onOpenWiki,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const wikiBtn = document.createElement('button')
      wikiBtn.setAttribute('data-wiki', 'notes/meeting.md')
      wikiBtn.textContent = 'meeting.md'
      conversation.appendChild(wikiBtn)

      await fireEvent.click(wikiBtn)

      expect(onOpenWiki).toHaveBeenCalledWith('notes/meeting.md')
    })

    it('handles keyboard activation with Enter key', async () => {
      const onOpenWiki = vi.fn()

      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
          onOpenWiki,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const wikiBtn = document.createElement('button')
      wikiBtn.setAttribute('data-wiki', 'notes/test.md')
      conversation.appendChild(wikiBtn)

      await fireEvent.keyDown(wikiBtn, { key: 'Enter' })

      expect(onOpenWiki).toHaveBeenCalledWith('notes/test.md')
    })

    it('handles keyboard activation with Space key', async () => {
      const onSwitchToCalendar = vi.fn()

      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
          onSwitchToCalendar,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const dateBtn = document.createElement('button')
      dateBtn.setAttribute('data-date', '2024-01-01')
      conversation.appendChild(dateBtn)

      await fireEvent.keyDown(dateBtn, { key: ' ' })

      expect(onSwitchToCalendar).toHaveBeenCalledWith('2024-01-01')
    })

    it('ignores other keys', async () => {
      const onOpenWiki = vi.fn()

      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
          onOpenWiki,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const wikiBtn = document.createElement('button')
      wikiBtn.setAttribute('data-wiki', 'notes/test.md')
      conversation.appendChild(wikiBtn)

      await fireEvent.keyDown(wikiBtn, { key: 'Tab' })

      expect(onOpenWiki).not.toHaveBeenCalled()
    })
  })

  describe('date popover', () => {
    it('shows popover on mouseover of data-date element', async () => {
      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const dateBtn = document.createElement('button')
      dateBtn.setAttribute('data-date', '2024-06-20')
      dateBtn.textContent = 'June 20'

      Object.defineProperty(dateBtn, 'getBoundingClientRect', {
        value: () => ({
          left: 100,
          right: 200,
          top: 50,
          bottom: 80,
          width: 100,
          height: 30,
        }),
      })

      conversation.appendChild(dateBtn)

      await fireEvent.mouseOver(dateBtn)
      await tick()

      const popover = screen.getByTestId('calendar-date-popover')
      expect(popover).toHaveAttribute('data-date', '2024-06-20')
    })

    it('hides popover after mouseout with delay', async () => {
      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const dateBtn = document.createElement('button')
      dateBtn.setAttribute('data-date', '2024-06-20')

      Object.defineProperty(dateBtn, 'getBoundingClientRect', {
        value: () => ({ left: 100, right: 200, top: 50, bottom: 80, width: 100, height: 30 }),
      })

      conversation.appendChild(dateBtn)

      await fireEvent.mouseOver(dateBtn)
      await tick()
      expect(screen.getByTestId('calendar-date-popover')).toBeInTheDocument()

      await fireEvent.mouseOut(dateBtn)
      vi.advanceTimersByTime(250)
      await tick()

      expect(screen.queryByTestId('calendar-date-popover')).not.toBeInTheDocument()
    })

    it('keeps popover visible when onKeep is called (mouse enters popover)', async () => {
      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const dateBtn = document.createElement('button')
      dateBtn.setAttribute('data-date', '2024-07-01')

      Object.defineProperty(dateBtn, 'getBoundingClientRect', {
        value: () => ({ left: 100, right: 200, top: 50, bottom: 80, width: 100, height: 30 }),
      })

      conversation.appendChild(dateBtn)

      await fireEvent.mouseOver(dateBtn)
      await tick()

      const popover = screen.getByTestId('calendar-date-popover')
      expect(popover).toBeInTheDocument()

      await fireEvent.mouseOut(dateBtn)

      await fireEvent.mouseEnter(popover)
      vi.advanceTimersByTime(300)
      await tick()

      expect(screen.getByTestId('calendar-date-popover')).toBeInTheDocument()
    })

    it('starts close timer when onStartClose is called (mouse leaves popover)', async () => {
      const { container } = render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      const conversation = container.querySelector('.conversation')!
      const dateBtn = document.createElement('button')
      dateBtn.setAttribute('data-date', '2024-07-02')

      Object.defineProperty(dateBtn, 'getBoundingClientRect', {
        value: () => ({ left: 100, right: 200, top: 50, bottom: 80, width: 100, height: 30 }),
      })

      conversation.appendChild(dateBtn)

      await fireEvent.mouseOver(dateBtn)
      await tick()

      const popover = screen.getByTestId('calendar-date-popover')
      expect(popover).toBeInTheDocument()

      await fireEvent.mouseLeave(popover)
      vi.advanceTimersByTime(200)
      await tick()

      expect(screen.queryByTestId('calendar-date-popover')).not.toBeInTheDocument()
    })
  })

  describe('reduced motion', () => {
    it('registers matchMedia listener for reduced motion', async () => {
      const listeners: Array<() => void> = []
      const mockMq = {
        matches: false,
        addEventListener: vi.fn((_: string, cb: () => void) => listeners.push(cb)),
        removeEventListener: vi.fn(),
      }

      vi.spyOn(window, 'matchMedia').mockReturnValue(mockMq as unknown as MediaQueryList)

      render(AgentConversation, {
        props: {
          messages: [],
          streaming: false,
        },
      })

      expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    })
  })

  describe('streaming prop', () => {
    it('passes streaming state to child ChatMessageRow components', () => {
      render(AgentConversation, {
        props: {
          messages: [createAssistantMessage('Working...')],
          streaming: true,
        },
      })

      const rows = screen.getAllByTestId('chat-message-row')
      expect(rows.length).toBe(1)
    })
  })
})
