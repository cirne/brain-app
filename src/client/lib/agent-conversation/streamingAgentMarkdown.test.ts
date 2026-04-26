import { describe, expect, it } from 'vitest'
import { STREAMING_AGENT_MD_MAX, streamingAgentMessageHtml } from './streamingAgentMarkdown.js'

describe('streamingAgentMessageHtml', () => {
  it('renders markdown including bold', () => {
    const html = streamingAgentMessageHtml('**Planning** next')
    expect(html).toContain('<strong>')
    expect(html).toContain('Planning')
  })

  it('renders unordered and ordered lists as ul/ol/li', () => {
    const md = '- one\n- two\n\n1. first\n2. second'
    const html = streamingAgentMessageHtml(md)
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
    expect(html.match(/<li>/g)?.length).toBe(4)
  })

  it('caps length before rendering', () => {
    const long = `${'a'.repeat(20)}**b**`
    const html = streamingAgentMessageHtml(long, 12)
    expect(html.includes('strong')).toBe(false)
  })

  it('strips trailing suggest_reply_options JSON leaked into prose', () => {
    const json = JSON.stringify({
      choices: [{ label: 'OK', submit: 'go' }],
    })
    const html = streamingAgentMessageHtml(`Done.\n\n${json}`)
    expect(html).not.toContain('choices')
    expect(html).toContain('Done')
  })

  it('exports a sane default max constant', () => {
    expect(STREAMING_AGENT_MD_MAX).toBeGreaterThan(1000)
  })
})
