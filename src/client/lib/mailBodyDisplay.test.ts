import { describe, expect, it } from 'vitest'
import {
  emailBodyToIframeSrcdoc,
  escapeAndLinkifyUrls,
  looksLikeEmailHtml,
  mailBodyToDisplayHtml,
  roughHtmlToPlainText,
  stripCssLikeLines,
  stripEmailEmbeddedTags,
} from './mailBodyDisplay.js'

describe('mailBodyDisplay', () => {
  it('emailBodyToIframeSrcdoc wraps fragments and passes through full documents', () => {
    const wrapped = emailBodyToIframeSrcdoc('<p class="x">Hi</p>')
    expect(wrapped).toContain('<!DOCTYPE html>')
    expect(wrapped).toContain('<meta charset="utf-8">')
    expect(wrapped).toContain('max-width: 100%')
    expect(wrapped).toContain('overflow-y: hidden')
    expect(wrapped).toContain('padding: 0 1rem 1rem')
    expect(wrapped).toContain('overflow-wrap: break-word')
    expect(wrapped).toContain('<p class="x">Hi</p>')
    expect(wrapped).toContain('--mail-bg')
    expect(wrapped).toContain('prefers-color-scheme: dark')
    expect(wrapped).toContain('body *')
    expect(wrapped).toContain('color: var(--mail-accent) !important')
    expect(wrapped).toContain('border-radius: 0 !important')
    const full = '<!DOCTYPE html><html><body>x</body></html>'
    const passthrough = emailBodyToIframeSrcdoc(full)
    expect(passthrough).toContain('overflow-y: hidden')
    expect(passthrough).toContain('padding: 0 1rem 1rem')
    expect(passthrough).toContain('x</body>')
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
