import { describe, expect, it } from 'vitest'
import {
  emailDisplayBodyToIframeSrcdoc,
  escapeAndLinkifyUrls,
} from './mailBodyDisplay.js'

describe('mailBodyDisplay', () => {
  it('emailDisplayBodyToIframeSrcdoc wraps explicit text bodies in a newline-preserving container', () => {
    const wrapped = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'text',
      bodyText: ['Good morning', '> quoted reply <not-html>', 'See https://ex.com'].join('\n'),
    })

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
    expect(wrapped).toContain('--mail-bg: #f4f1eb')
    expect(wrapped).toContain('color-scheme: light')
    expect(wrapped).not.toContain('prefers-color-scheme')
    expect(wrapped).toContain('border-radius: 0 !important')
  })

  it('emailDisplayBodyToIframeSrcdoc treats quoted email addresses and angle-bracket URLs as plaintext', () => {
    const wrapped = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'text',
      bodyText: [
        'Begin forwarded message:',
        '> From: Geoff Cannon <geoff@jillandgeoff.com>',
        '> To: Ashar Rizqi <ashar@bountihq.com>',
        '> The big news: we launched b.claw by bounti.ai <http://bounti.ai/>.',
        '> On Fri, May 8, Ashar <ashar@bountihq.com <mailto:ashar@bountihq.com>> wrote:',
      ].join('\n'),
    })

    expect(wrapped).toContain('<div class="mail-plain-body">')
    expect(wrapped).toContain('&gt; From: Geoff Cannon &lt;geoff@jillandgeoff.com&gt;')
    expect(wrapped).toContain('&lt;<a href="http://bounti.ai/"')
    expect(wrapped).toContain('http://bounti.ai/</a>&gt;')
    expect(wrapped).toContain('\n&gt; To: Ashar')
  })

  it('emailDisplayBodyToIframeSrcdoc passes through full HTML documents and wraps fragments', () => {
    const full = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'html',
      bodyText: '',
      bodyHtml: '<!DOCTYPE html><html><body>x</body></html>',
    })
    expect(full).toContain('overflow-y: hidden')
    expect(full).toContain('padding: 0 1rem 1rem')
    expect(full).toContain('x</body>')

    const fragment = '<table><tr><td>Hi</td></tr></table>'
    const wrappedFragment = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'html',
      bodyText: '',
      bodyHtml: fragment,
    })
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

  it('rewrites cid image sources to visual artifact URLs inside HTML mail', () => {
    const wrapped = emailDisplayBodyToIframeSrcdoc({
      bodyKind: 'html',
      bodyText: '',
      bodyHtml: '<p>photo</p><img src="cid:image001.jpg@abc" alt="photo">',
      visualArtifacts: [
        {
          kind: 'image',
          mime: 'image/jpeg',
          ref: 'va1.photo',
          label: 'photo.jpg',
          origin: {
            kind: 'mailAttachment',
            messageId: 'msg-1',
            attachmentIndex: 1,
            filename: 'photo.jpg',
          },
          readStatus: 'available',
        },
      ],
    })

    expect(wrapped).toContain('src="/api/files/artifact?ref=va1.photo"')
    expect(wrapped).not.toContain('cid:image001')
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
})
