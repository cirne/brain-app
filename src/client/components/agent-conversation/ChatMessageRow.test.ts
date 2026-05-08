import { describe, it, expect } from 'vitest'
import ChatMessageRow from './ChatMessageRow.svelte'
import { render, screen } from '@client/test/render.js'
import type { ChatMessage } from '@client/lib/agentUtils.js'

describe('ChatMessageRow.svelte', () => {
  it('renders user messages', () => {
    const msg: ChatMessage = { role: 'user', content: 'Ping' }
    render(ChatMessageRow, {
      props: {
        msg,
        streaming: false,
        isLastMessage: true,
        isLastAssistantInThread: false,
      },
    })
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Ping')).toBeInTheDocument()
  })

  it('renders assistant markdown parts', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [{ type: 'text', content: '**Bold** reply' }],
    }
    render(ChatMessageRow, {
      props: {
        msg,
        streaming: false,
        isLastMessage: true,
        isLastAssistantInThread: true,
      },
    })
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Bold')).toBeInTheDocument()
  })

  it('shows thinking dots while streaming before any text arrives', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [{ type: 'tool', toolCall: { id: '1', name: 'noop_tool', args: {}, done: true } }],
    }
    render(ChatMessageRow, {
      props: {
        msg,
        streaming: true,
        isLastMessage: true,
        isLastAssistantInThread: true,
      },
    })
    expect(screen.getByRole('status', { name: /assistant is working/i })).toBeInTheDocument()
    expect(document.querySelector('.streaming-busy-dots')).toBeTruthy()
  })

  it('renders person mentions in user messages with a handle chip', () => {
    const msg: ChatMessage = { role: 'user', content: 'thanks @alex for the note' }
    render(ChatMessageRow, {
      props: {
        msg,
        streaming: false,
        isLastMessage: true,
        isLastAssistantInThread: false,
      },
    })
    const chip = document.querySelector('.user-mention--person')
    expect(chip).toBeTruthy()
    expect(chip?.textContent ?? '').toContain('alex')
    expect(document.querySelector('.user-mention--wiki')).toBeNull()
  })

  it('renders wiki mentions in user messages with a document chip', () => {
    const msg: ChatMessage = { role: 'user', content: 'see @me/people/alex.md' }
    render(ChatMessageRow, {
      props: {
        msg,
        streaming: false,
        isLastMessage: true,
        isLastAssistantInThread: false,
      },
    })
    expect(document.querySelector('.user-mention--wiki')).toBeTruthy()
    expect(document.querySelector('.user-mention--person')).toBeNull()
  })

  it('uses detailed ToolCallBlock when toolDisplayMode is detailed', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: '',
      parts: [
        {
          type: 'tool',
          toolCall: {
            id: '1',
            name: 'read',
            args: { path: 'notes/x.md' },
            done: true,
            result: '{}',
          },
        },
      ],
    }
    const { container } = render(ChatMessageRow, {
      props: {
        msg,
        streaming: false,
        isLastMessage: true,
        isLastAssistantInThread: true,
        toolDisplayMode: 'detailed',
      },
    })
    expect(container.querySelector('details.tool-call')).toBeTruthy()
  })
})
