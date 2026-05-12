/**
 * Wrap a MIME body for `iframe.srcdoc` when it is not already a full document.
 * Ensures the browser parses markup as HTML (charset, viewport, links open in a new tab).
 * Plaintext bodies are escaped and wrapped with newline-preserving CSS. HTML bodies are not escaped —
 * combine with `sandbox` (no `allow-scripts`) on the iframe.
 * Injects base theme colors (`IFRAME_DOC_BASE_STYLE`) because srcdoc is isolated from host CSS variables.
 * Always uses a light canvas (`color-scheme: light`): HTML newsletters almost always rely on inline white
 * backgrounds and dark text; if the iframe followed the app/OS dark preference and forced pale text via
 * a blanket selector, pale text would sit on those unchanged white sections (unreadable).
 */

const IFRAME_DOC_BASE_STYLE = `<style>
  :root {
    --mail-bg: #ffffff;
    --mail-text: #111111;
    --mail-text-2: #6b7280;
    --mail-accent: #2563eb;
    --mail-border: #e0e0e0;
  }
  html {
    color-scheme: light;
    margin: 0 !important;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
    background: var(--mail-bg);
  }
  body {
    margin: 0 !important;
    padding: 0 1rem 1rem !important;
    overflow-x: hidden !important;
    overflow-y: hidden !important;
    box-sizing: border-box !important;
    background: var(--mail-bg);
    color: var(--mail-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    overflow-wrap: break-word !important;
    word-break: break-word !important;
  }
  a {
    color: var(--mail-accent);
    overflow-wrap: break-word !important;
    word-break: break-word !important;
  }
  .mail-plain-body {
    white-space: pre-wrap;
    font-family: inherit;
  }
  img, table { max-width: 100% !important; height: auto; }
  table { border-collapse: collapse; }
  /* Flatten sender “card” corners so HTML mail aligns with inbox chrome (no nested rounded slabs). */
  table, thead, tbody, tr, td, th, div, section, article, main {
    border-radius: 0 !important;
  }
</style>`

const IFRAME_FRAGMENT_HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank" rel="noopener noreferrer">${IFRAME_DOC_BASE_STYLE}`

export type EmailDisplayBody = {
  bodyKind: 'html' | 'text'
  bodyText: string
  bodyHtml?: string
}

/** Insert overflow/layout guard into a full HTML document so passthrough mail still has no inner scrolling. */
function injectIframeDocGuard(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (open) => `${open}${IFRAME_DOC_BASE_STYLE}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html[^>]*>/i,
      (open) => `${open}<head><meta charset="utf-8">${IFRAME_DOC_BASE_STYLE}</head>`,
    )
  }
  return html
}

function htmlBodyToIframeSrcdoc(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const passthrough = /^<!DOCTYPE\s+html/i.test(t) || /<\s*html[\s>]/i.test(t)
  return passthrough
    ? injectIframeDocGuard(raw)
    : `<!DOCTYPE html><html><head>${IFRAME_FRAGMENT_HEAD}</head><body>${raw}</body></html>`
}

function plaintextBodyToIframeSrcdoc(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  return `<!DOCTYPE html><html><head>${IFRAME_FRAGMENT_HEAD}</head><body><div class="mail-plain-body">${escapeAndLinkifyUrls(raw)}</div></body></html>`
}

export function emailDisplayBodyToIframeSrcdoc(body: EmailDisplayBody): string {
  if (body.bodyKind === 'html' && body.bodyHtml?.trim()) {
    return htmlBodyToIframeSrcdoc(body.bodyHtml)
  }
  return plaintextBodyToIframeSrcdoc(body.bodyText)
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Escape HTML and turn bare http(s) URLs into links (safe subset for mail bodies). */
export function escapeAndLinkifyUrls(text: string): string {
  const urlPattern = /https?:\/\/[^\s)>\]"]+/g
  let html = ''
  let lastIndex = 0
  for (const match of text.matchAll(urlPattern)) {
    const url = match[0]
    const index = match.index ?? 0
    html += escapeHtmlText(text.slice(lastIndex, index))
    const escapedUrl = escapeHtmlText(url)
    html += `<a href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapedUrl}</a>`
    lastIndex = index + url.length
  }
  html += escapeHtmlText(text.slice(lastIndex))
  return html
}
