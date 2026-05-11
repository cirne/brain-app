import { describe, expect, it } from 'vitest'
import {
  emailBodyToIframeSrcdoc,
  emailDisplayBodyToIframeSrcdoc,
  escapeAndLinkifyUrls,
  looksLikeEmailHtml,
  mailBodyToDisplayHtml,
  roughHtmlToPlainText,
  stripCssLikeLines,
  stripEmailEmbeddedTags,
} from './mailBodyDisplay.js'

describe('mailBodyDisplay', () => {
  it('emailBodyToIframeSrcdoc wraps plaintext bodies in a newline-preserving sans-serif container', () => {
    const wrapped = emailBodyToIframeSrcdoc(
      ['Good morning', '> quoted reply <not-html>', 'See https://ex.com'].join('\n'),
    )
    expect(wrapped).toContain('<!DOCTYPE html>')
    expect(wrapped).toContain('<meta charset="utf-8">')
    expect(wrapped).toContain('max-width: 100%')
    expect(wrapped).toContain('overflow-y: hidden')
    expect(wrapped).toContain('padding: 0 1rem 1rem')
    expect(wrapped).toContain('overflow-wrap: break-word')
    expect(wrapped).toContain('.mail-plain-body')
    expect(wrapped).toContain('white-space: pre-wrap')
    expect(wrapped).toContain('font-family: inherit')
    expect(wrapped).toContain('<div class="mail-plain-body">')
    expect(wrapped).toContain('Good morning\n&gt; quoted reply &lt;not-html&gt;\nSee ')
    expect(wrapped).toContain('<a href="https://ex.com"')
    expect(wrapped).toContain('--mail-bg')
    expect(wrapped).toContain('prefers-color-scheme: dark')
    expect(wrapped).toContain('body *')
    expect(wrapped).toContain('color: var(--mail-accent) !important')
    expect(wrapped).toContain('border-radius: 0 !important')
  })

  it('emailBodyToIframeSrcdoc treats quoted email addresses and angle-bracket URLs as plaintext', () => {
    const wrapped = emailBodyToIframeSrcdoc(
      [
        'Begin forwarded message:',
        '> From: Geoff Cannon <geoff@jillandgeoff.com>',
        '> To: Ashar Rizqi <ashar@bountihq.com>',
        '> The big news: we launched b.claw by bounti.ai <http://bounti.ai/>.',
        '> On Fri, May 8, Ashar <ashar@bountihq.com <mailto:ashar@bountihq.com>> wrote:',
      ].join('\n'),
    )

    expect(wrapped).toContain('<div class="mail-plain-body">')
    expect(wrapped).toContain('&gt; From: Geoff Cannon &lt;geoff@jillandgeoff.com&gt;')
    expect(wrapped).toContain('&lt;<a href="http://bounti.ai/"')
    expect(wrapped).toContain('http://bounti.ai/</a>&gt;')
    expect(wrapped).toContain('\n&gt; To: Ashar')
  })

  it('looksLikeEmailHtml ignores repeated plaintext address and URL angle brackets', () => {
    const forwardedHeaders = Array.from(
      { length: 12 },
      (_, i) => `> From: Person ${i} <person${i}@example.com> via <http://example.com/${i}>`,
    ).join('\n')

    expect(looksLikeEmailHtml(forwardedHeaders)).toBe(false)
    expect(emailBodyToIframeSrcdoc(forwardedHeaders)).toContain('<div class="mail-plain-body">')
  })

  it('emailBodyToIframeSrcdoc passes through full documents and likely HTML fragments', () => {
    const full = '<!DOCTYPE html><html><body>x</body></html>'
    const passthrough = emailBodyToIframeSrcdoc(full)
    expect(passthrough).toContain('overflow-y: hidden')
    expect(passthrough).toContain('padding: 0 1rem 1rem')
    expect(passthrough).toContain('x</body>')

    const fragment = '<table><tr><td>Hi</td></tr></table>'
    const wrappedFragment = emailBodyToIframeSrcdoc(fragment)
    expect(wrappedFragment).toContain(fragment)
    expect(wrappedFragment).not.toContain('&lt;table&gt;')
  })

  it('emailDisplayBodyToIframeSrcdoc renders explicit text bodies without HTML guessing', () => {
    const wrapped = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'text',
      bodyText: '> From: Geoff <geoff@example.com>\n<p>not html</p>',
    })

    expect(wrapped).toContain('<div class="mail-plain-body">')
    expect(wrapped).toContain('&gt; From: Geoff &lt;geoff@example.com&gt;')
    expect(wrapped).toContain('&lt;p&gt;not html&lt;/p&gt;')
  })

  it('emailDisplayBodyToIframeSrcdoc renders explicit HTML bodies as HTML', () => {
    const wrapped = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'html',
      bodyText: 'Plain fallback',
      bodyHtml: '<p class="x">HTML body</p>',
    })

    expect(wrapped).toContain('<p class="x">HTML body</p>')
    expect(wrapped).not.toContain('&lt;p class="x"&gt;')
    expect(wrapped).not.toContain('<div class="mail-plain-body">')
  })

  it('emailDisplayBodyToIframeSrcdoc falls back to explicit text when HTML body is missing', () => {
    const wrapped = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'html',
      bodyText: 'Plain fallback',
    })

    expect(wrapped).toContain('<div class="mail-plain-body">Plain fallback</div>')
  })

  it('escapeAndLinkifyUrls escapes markup and wraps URLs', () => {
    expect(escapeAndLinkifyUrls('<b>x</b>')).toContain('&lt;b&gt;')
    expect(escapeAndLinkifyUrls('x https://ex.com y')).toContain('<a href="https://ex.com"')
  })

  it('mailBodyToDisplayHtml keeps single block as one escaped string', () => {
    expect(mailBodyToDisplayHtml('a\nb')).toBe(escapeAndLinkifyUrls('a\nb'))
    expect(mailBodyToDisplayHtml('only')).not.toContain('<p')
  })

  it('mailBodyToDisplayHtml splits on blank lines into paragraphs', () => {
    const html = mailBodyToDisplayHtml('First para.\n\nSecond para.')
    expect(html).toContain('<p class="mail-para">')
    expect(html.match(/<p class="mail-para">/g)?.length).toBe(2)
    expect(html).toContain('First para.')
    expect(html).toContain('Second para.')
  })

  it('stripEmailEmbeddedTags removes style blocks', () => {
    const s = stripEmailEmbeddedTags('<style>.x{color:red}</style><p>Hi</p>')
    expect(s).not.toContain('color:red')
    expect(s).toContain('Hi')
  })

  it('roughHtmlToPlainText drops tags and keeps text', () => {
    expect(roughHtmlToPlainText('<p>Hello <b>you</b></p>')).toMatch(/Hello\s+you/)
  })

  it('stripCssLikeLines removes @import and comment starts', () => {
    const t = stripCssLikeLines(
      ['Namecheap', '', '/* CUSTOM FONT */', "@import url('https://fonts.googleapis.com');", 'Hello'].join(
        '\n',
      ),
    )
    expect(t).toContain('Namecheap')
    expect(t).toContain('Hello')
    expect(t).not.toContain('fonts.googleapis.com')
  })

  it('mailBodyToDisplayHtml strips newsletter CSS noise and keeps message text', () => {
    const junk = [
      'Namecheap',
      '',
      '/* CLIENT-SPECIFIC STYLES */',
      'body, table, td, a { -webkit-text-size-adjust: 100%; }',
      '.btn_orange { background: #fd4f00; }',
      '',
      'Payment will be taken from your selected credit card.',
    ].join('\n')
    const out = mailBodyToDisplayHtml(junk)
    expect(out).toContain('Payment will be taken')
    expect(out).toContain('Namecheap')
    expect(out).not.toContain('webkit-text-size-adjust')
    expect(out).not.toContain('btn_orange')
  })

  it('looksLikeEmailHtml detects typical newsletter HTML', () => {
    expect(looksLikeEmailHtml('<html><body><table><tr><td>x</td></tr></table></body></html>')).toBe(
      true,
    )
    expect(looksLikeEmailHtml('Just plain words')).toBe(false)
  })
})
