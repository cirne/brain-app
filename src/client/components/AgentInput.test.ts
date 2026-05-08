import { describe, it, expect, vi, beforeEach } from 'vitest'
import AgentInput from './AgentInput.svelte'
import { render, fireEvent, screen, waitFor } from '@client/test/render.js'
import { agentInputTestProps, testSkillSummarize } from '@client/test/helpers/index.js'
import type { SkillMenuItem } from '@client/lib/agentUtils.js'

describe('AgentInput.svelte', () => {
  describe('basic send behavior', () => {
    it('calls onSend when Enter is pressed with non-empty text', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'hello world' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false })

      expect(props.onSend).toHaveBeenCalledWith('hello world')
    })

    it('does not submit on Shift+Enter', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'line' } })
      await fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })

      expect(props.onSend).not.toHaveBeenCalled()
    })

    it('does not send empty or whitespace-only text', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '   ' } })
      await fireEvent.keyDown(ta, { key: 'Enter' })

      expect(props.onSend).not.toHaveBeenCalled()
    })

    it('clears input after sending', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: 'message' } })
      await fireEvent.keyDown(ta, { key: 'Enter' })

      expect(ta.value).toBe('')
    })

    it('does not send when disabled', async () => {
      const props = agentInputTestProps({ disabled: true })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'x' } })
      await fireEvent.keyDown(ta, { key: 'Enter' })

      expect(props.onSend).not.toHaveBeenCalled()
    })

    it('sends via button click', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'click send' } })

      const sendBtn = screen.getByRole('button', { name: /send/i })
      await fireEvent.click(sendBtn)

      expect(props.onSend).toHaveBeenCalledWith('click send')
    })

    it('disables send button when input is empty', () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const sendBtn = screen.getByRole('button', { name: /send/i })
      expect(sendBtn).toBeDisabled()
    })

    it('renders new chat on the left and calls onNewChat when provided', async () => {
      const onNewChat = vi.fn()
      const props = agentInputTestProps({ onNewChat })
      render(AgentInput, { props })

      const newBtn = screen.getByRole('button', { name: 'New chat' })
      await fireEvent.click(newBtn)
      expect(onNewChat).toHaveBeenCalledTimes(1)
    })
  })

  describe('@mention menu', () => {
    function mockEmptyHandlesFetch() {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/api/account/workspace-handles')) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 })
        }
        return new Response('{}', { status: 200 })
      }) as typeof fetch
    }

    it('shows mention menu for @ and inserts path on pick', async () => {
      mockEmptyHandlesFetch()
      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md', 'me/ideas/note.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@ali' } })

      const opt = await screen.findByRole('option', { name: /alice/i })
      await fireEvent.mouseDown(opt)

      expect((ta as HTMLTextAreaElement).value).toContain('@me/people/alice.md')
    })

    it('navigates mention menu with arrow keys', async () => {
      mockEmptyHandlesFetch()
      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md', 'me/people/bob.md', 'me/people/carol.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@' } })

      await screen.findByRole('option', { name: /alice/i })

      await fireEvent.keyDown(ta, { key: 'ArrowDown' })
      await fireEvent.keyDown(ta, { key: 'ArrowDown' })
      await fireEvent.keyDown(ta, { key: 'ArrowUp' })
      await fireEvent.keyDown(ta, { key: 'Enter' })

      expect((ta as HTMLTextAreaElement).value).toContain('@me/people/bob.md')
    })

    it('selects mention with Tab key', async () => {
      mockEmptyHandlesFetch()
      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@ali' } })

      await screen.findByRole('option', { name: /alice/i })
      await fireEvent.keyDown(ta, { key: 'Tab' })

      expect((ta as HTMLTextAreaElement).value).toContain('@me/people/alice.md')
    })

    it('closes mention menu on Escape', async () => {
      mockEmptyHandlesFetch()
      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@' } })

      await screen.findByRole('option', { name: /alice/i })
      await fireEvent.keyDown(ta, { key: 'Escape' })

      expect(screen.queryByRole('option', { name: /alice/i })).toBeNull()
    })

    it('shows empty-state message when nothing matches', async () => {
      mockEmptyHandlesFetch()
      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@xyz' } })

      expect(await screen.findByText(/no matches/i)).toBeInTheDocument()
    })

    it('hides mention menu when @ is followed by space', async () => {
      mockEmptyHandlesFetch()
      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@ ' } })

      expect(screen.queryByRole('option', { name: /alice/i })).toBeNull()
    })

    it('lists workspace handles under a People section and inserts @handle on pick', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/api/account/workspace-handles')) {
          return new Response(
            JSON.stringify({
              results: [
                {
                  userId: 'usr_aaaa',
                  handle: 'cirne',
                  displayName: 'Lewis Cirne',
                  primaryEmail: 'cirne@example.com',
                },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 200 })
      }) as typeof fetch

      const props = agentInputTestProps({
        wikiFiles: ['me/people/alice.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@cir' } })

      const peopleOption = await screen.findByRole('option', { name: /@cirne.*Lewis Cirne/i })
      expect(screen.getByText(/^People$/)).toBeInTheDocument()
      await fireEvent.mouseDown(peopleOption)

      expect((ta as HTMLTextAreaElement).value).toContain('@cirne')
      expect((ta as HTMLTextAreaElement).value).not.toContain('@cirne/')
    })

    it('puts People above Documents in the keyboard order', async () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/api/account/workspace-handles')) {
          return new Response(
            JSON.stringify({
              results: [{ userId: 'usr_a', handle: 'amy', primaryEmail: null }],
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 200 })
      }) as typeof fetch

      const props = agentInputTestProps({
        wikiFiles: ['me/people/alex.md'],
      })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '@a' } })

      await screen.findByRole('option', { name: /@amy/i })

      await fireEvent.keyDown(ta, { key: 'Enter' })
      expect((ta as HTMLTextAreaElement).value).toContain('@amy')
    })
  })

  describe('/slash command menu', () => {
    const skills: SkillMenuItem[] = [
      { slug: 'summarize', name: 'summarize', label: 'Summarize content', description: 'd' },
      { slug: 'search', name: 'search', label: 'Search the web', description: 'd' },
      { slug: 'translate', name: 'translate', label: 'Translate text', description: 'd' },
    ]

    it('shows slash menu when typing / at line start', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/' } })

      expect(await screen.findByText('/summarize')).toBeInTheDocument()
    })

    it('filters skills by query', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/sum' } })

      expect(await screen.findByText('/summarize')).toBeInTheDocument()
      expect(screen.queryByText('/search')).toBeNull()
    })

    it('navigates slash menu with arrow keys', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/' } })

      await screen.findByText('/summarize')

      await fireEvent.keyDown(ta, { key: 'ArrowDown' })
      await fireEvent.keyDown(ta, { key: 'ArrowDown' })
      await fireEvent.keyDown(ta, { key: 'ArrowUp' })
      await fireEvent.keyDown(ta, { key: 'Enter' })

      expect((ta as HTMLTextAreaElement).value).toContain('/search')
    })

    it('selects skill with Tab key', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/sum' } })

      await screen.findByText('/summarize')
      await fireEvent.keyDown(ta, { key: 'Tab' })

      expect((ta as HTMLTextAreaElement).value).toContain('/summarize')
    })

    it('selects skill via mouse click', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/' } })

      const opt = await screen.findByText('/search')
      await fireEvent.mouseDown(opt.closest('button')!)

      expect((ta as HTMLTextAreaElement).value).toContain('/search')
    })

    it('closes slash menu on Escape', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/' } })

      await screen.findByText('/summarize')
      await fireEvent.keyDown(ta, { key: 'Escape' })

      expect(screen.queryByText('/summarize')).toBeNull()
    })

    it('shows "No matching skills" when filter has no results', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/xyz' } })

      expect(await screen.findByText('No matching skills')).toBeInTheDocument()
    })

    it('hides slash menu after cursor moves past space', async () => {
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: '/summarize ' } })

      expect(screen.queryByText('/summarize')).toBeNull()
    })
  })

  describe('streaming state', () => {
    it('calls onStop when streaming and stop is clicked', async () => {
      const onStop = vi.fn()
      const props = agentInputTestProps({ onStop, streaming: true })
      render(AgentInput, { props })

      await fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
      expect(onStop).toHaveBeenCalled()
    })

    it('shows queue button label when streaming', () => {
      const props = agentInputTestProps({ streaming: true })
      render(AgentInput, { props })

      const queueBtn = screen.getByRole('button', { name: /queue/i })
      expect(queueBtn).toBeInTheDocument()
    })
  })

  describe('queuedMessages', () => {
    it('displays queued messages', () => {
      const props = {
        ...agentInputTestProps(),
        queuedMessages: ['First queued', 'Second queued'],
      }
      render(AgentInput, { props })

      expect(screen.getByText('First queued')).toBeInTheDocument()
      expect(screen.getByText('Second queued')).toBeInTheDocument()
    })

    it('has accessible list role for queued messages', () => {
      const props = {
        ...agentInputTestProps(),
        queuedMessages: ['Queued item'],
      }
      render(AgentInput, { props })

      const list = screen.getByRole('list', { name: /queued/i })
      expect(list).toBeInTheDocument()
      expect(screen.getByRole('listitem')).toBeInTheDocument()
    })
  })

  describe('onDraftChange callback', () => {
    it('calls onDraftChange when typing', async () => {
      const onDraftChange = vi.fn()
      const props = {
        ...agentInputTestProps(),
        onDraftChange,
      }
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'draft' } })

      expect(onDraftChange).toHaveBeenCalledWith('draft')
    })

    it('calls onDraftChange with empty string after send', async () => {
      const onDraftChange = vi.fn()
      const props = {
        ...agentInputTestProps(),
        onDraftChange,
      }
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: 'msg' } })
      await fireEvent.keyDown(ta, { key: 'Enter' })

      expect(onDraftChange).toHaveBeenLastCalledWith('')
    })
  })

  describe('placeholder', () => {
    it('shows default placeholder', () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      expect(
        screen.getByPlaceholderText('What do you need to know or get done?'),
      ).toBeInTheDocument()
    })

    it('shows custom placeholder', () => {
      const props = {
        ...agentInputTestProps(),
        placeholder: 'Type here...',
      }
      render(AgentInput, { props })

      expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument()
    })
  })

  describe('transparentSurround', () => {
    it('applies transparent class when transparentSurround is true', () => {
      const props = {
        ...agentInputTestProps(),
        transparentSurround: true,
      }
      const { container } = render(AgentInput, { props })

      const inputArea = container.querySelector('.input-area')
      expect(inputArea).toHaveClass('input-area--transparent')
    })
  })

  describe('textarea auto-resize', () => {
    it('resizes textarea on input', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      const longText = 'Line1\nLine2\nLine3\nLine4\nLine5'
      await fireEvent.input(ta, { target: { value: longText } })

      expect(ta.style.height).not.toBe('')
    })
  })

  describe('focus management', () => {
    it('focuses textarea on mount when not disabled', async () => {
      const props = agentInputTestProps()
      render(AgentInput, { props })

      await waitFor(() => {
        expect(screen.getByRole('textbox')).toHaveFocus()
      })
    })

    it('does not focus textarea on mount when disabled', async () => {
      const props = agentInputTestProps({ disabled: true })
      render(AgentInput, { props })

      await new Promise(r => setTimeout(r, 50))
      expect(screen.getByRole('textbox')).not.toHaveFocus()
    })
  })

  describe('exported methods', () => {
    it('appendText adds text to draft with separator', async () => {
      const props = agentInputTestProps()
      const { component } = render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: 'existing' } })

      component.appendText('@wiki/note.md')

      await waitFor(() => {
        expect(ta.value).toBe('existing @wiki/note.md')
      })
    })

    it('appendText does nothing for empty string', async () => {
      const props = agentInputTestProps()
      const { component } = render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: 'text' } })

      component.appendText('')

      expect(ta.value).toBe('text')
    })

    it('appendText skips separator when draft ends with space', async () => {
      const props = agentInputTestProps()
      const { component } = render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: 'text ' } })

      component.appendText('more')

      await waitFor(() => {
        expect(ta.value).toBe('text more')
      })
    })

    it('appendText skips separator when draft ends with newline', async () => {
      const props = agentInputTestProps()
      const { component } = render(AgentInput, { props })

      const ta = screen.getByRole('textbox') as HTMLTextAreaElement
      await fireEvent.input(ta, { target: { value: 'text\n' } })

      component.appendText('more')

      await waitFor(() => {
        expect(ta.value).toBe('text\nmore')
      })
    })

    it('focus() method focuses the textarea', async () => {
      const props = agentInputTestProps()
      const { component } = render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      ta.blur()
      expect(ta).not.toHaveFocus()

      component.focus()

      expect(ta).toHaveFocus()
    })
  })

  describe('voice lead vs new chat lead', () => {
    it('shows new chat alongside voice entry when unified composer exposes both controls', async () => {
      const onNewChat = vi.fn()
      const onVoiceEntry = vi.fn()
      const props = agentInputTestProps({
        onNewChat,
        showVoiceEntry: true,
        onVoiceEntry,
        voiceEntryDisabled: false,
      })
      render(AgentInput, { props })
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
      const voiceBtn = screen.getByRole('button', { name: 'Voice input' })
      expect(voiceBtn).toBeInTheDocument()
      await fireEvent.click(voiceBtn)
      expect(onVoiceEntry).toHaveBeenCalled()
      expect(onNewChat).not.toHaveBeenCalled()
    })

    it('shows new chat on the left when voice entry is off', () => {
      const onNewChat = vi.fn()
      const props = agentInputTestProps({
        onNewChat,
        showVoiceEntry: false,
      })
      render(AgentInput, { props })
      expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Voice input' })).not.toBeInTheDocument()
    })
  })

  describe('skill sorting', () => {
    it('sorts skills with prefix matches first', async () => {
      const skills: SkillMenuItem[] = [
        { slug: 'xyz-search', name: 'xyz-search', label: 'XYZ Search', description: 'd' },
        { slug: 'search', name: 'search', label: 'Search', description: 'd' },
        { slug: 'research', name: 'research', label: 'Research', description: 'd' },
      ]
      const props = agentInputTestProps({ skills })
      render(AgentInput, { props })

      const ta = screen.getByRole('textbox')
      await fireEvent.input(ta, { target: { value: '/search' } })

      const buttons = await screen.findAllByRole('button')
      const slugs = buttons.map(b => b.textContent?.match(/\/(\S+)/)?.[1]).filter(Boolean)

      expect(slugs[0]).toBe('search')
    })
  })
})
