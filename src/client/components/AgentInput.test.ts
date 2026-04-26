import { describe, it, expect, vi } from 'vitest'
import AgentInput from './AgentInput.svelte'
import { render, fireEvent, screen } from '@client/test/render.js'
import { agentInputTestProps } from '@client/test/helpers/index.js'

describe('AgentInput.svelte', () => {
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

  it('shows mention menu for @ and inserts path on pick', async () => {
    const props = agentInputTestProps({
      wikiFiles: ['people/alice.md', 'ideas/note.md'],
    })
    render(AgentInput, { props })

    const ta = screen.getByRole('textbox')
    await fireEvent.input(ta, { target: { value: '@ali' } })

    const opt = await screen.findByRole('button', { name: /alice/i })
    await fireEvent.mouseDown(opt)

    expect((ta as HTMLTextAreaElement).value).toContain('@people/alice.md')
  })

  it('calls onStop when streaming and stop is clicked', async () => {
    const onStop = vi.fn()
    const props = agentInputTestProps({ onStop, streaming: true })
    render(AgentInput, { props })

    await fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('does not send when disabled', async () => {
    const props = agentInputTestProps({ disabled: true })
    render(AgentInput, { props })

    const ta = screen.getByRole('textbox')
    await fireEvent.input(ta, { target: { value: 'x' } })
    await fireEvent.keyDown(ta, { key: 'Enter' })

    expect(props.onSend).not.toHaveBeenCalled()
  })
})
