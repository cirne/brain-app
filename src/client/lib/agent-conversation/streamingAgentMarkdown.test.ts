import { describe, expect, it } from 'vitest'
import {
  assistantWikiReferenceHtml,
  STREAMING_AGENT_MD_MAX,
  streamingAgentMessageHtml,
} from './streamingAgentMarkdown.js'

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

  it('upgrades expected wiki-root markdown links to WikiFileName mount placeholders', () => {
    const html = streamingAgentMessageHtml(
      'Opened [Canada](travel/2026-07-west-coast-canada/canada.md).',
    )

    expect(html).toContain('data-brain-wiki-chip')
    expect(html).toContain('data-wiki="travel/2026-07-west-coast-canada/canada.md"')
    expect(html).not.toContain('<code>')
  })

  it('keeps normal external markdown links as anchors', () => {
    const html = streamingAgentMessageHtml('[Example](https://example.com)')

    expect(html).toContain('<a href="https://example.com">Example</a>')
    expect(html).not.toContain('data-brain-wiki-chip')
  })

  it('keeps ordinary inline code unchanged', () => {
    const html = streamingAgentMessageHtml('Run `const x = 1`.')

    expect(html).toContain('<code>const x = 1</code>')
    expect(html).not.toContain('data-brain-wiki-chip')
  })

  it('does not upgrade wiki-like paths inside fenced code blocks', () => {
    const html = streamingAgentMessageHtml('```\ntravel/2026-07-west-coast-canada/canada.md\n```')

    expect(html).toContain('<pre><code>')
    expect(html).toContain('travel/2026-07-west-coast-canada/canada.md')
    expect(html).not.toContain('data-brain-wiki-chip')
  })

  it('keeps a narrow inline-code fallback for older @path transcripts', () => {
    const html = streamingAgentMessageHtml('Opened `@travel/2026-07-west-coast-canada/canada.md`.')

    expect(html).toContain('data-brain-wiki-chip')
    expect(html).toContain('data-wiki="travel/2026-07-west-coast-canada/canada.md"')
    expect(html).not.toContain('<code>@travel')
  })
})

describe('assistantWikiReferenceHtml', () => {
  it('upgrades existing data-wiki anchors without depending on link text', () => {
    const html = assistantWikiReferenceHtml(
      '<p>Opened <a href="#" data-wiki="travel/foo.md" class="wiki-link">that file</a>.</p>',
    )

    expect(html).toContain('data-brain-wiki-chip')
    expect(html).toContain('data-wiki="travel/foo.md"')
    expect(html).not.toContain('>that file</a>')
  })
})
