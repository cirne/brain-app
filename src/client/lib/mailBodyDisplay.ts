/**
 * Wrap a MIME body for `iframe.srcdoc` when it is not already a full document.
 * Ensures the browser parses markup as HTML (charset, viewport, links open in a new tab).
 * Plaintext bodies are escaped and wrapped with newline-preserving CSS. HTML bodies are not escaped —
 * combine with `sandbox` (no `allow-scripts`) on the iframe.
 * Injects base theme colors (`IFRAME_DOC_BASE_STYLE`) because srcdoc is isolated from host CSS variables;
 * values mirror `src/client/style.css` until the message’s own CSS or inline styles override.
 */
const IFRAME_DOC_BASE_STYLE = `<style>
  :root {
    --mail-bg: #ffffff;
    --mail-text: #111111;
    --mail-text-2: #6b7280;
    --mail-accent: #2563eb;
    --mail-border: #e0e0e0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --mail-bg: #0f0f0f;
      --mail-text: #e8e8e8;
      --mail-text-2: #999999;
      --mail-accent: #4a9eff;
      --mail-border: #2e2e2e;
    }
    /* Beat common inline / class colors from light-mode HTML mail (overrides only when not !important on sender side). */
    body * {
      color: var(--mail-text) !important;
    }
    a,
    a:link,
    a:visited,
    a:hover,
    a:active,
    a * {
      color: var(--mail-accent) !important;
    }
  }
  html {
    color-scheme: light dark;
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

export function emailBodyToIframeSrcdoc(raw: string): string {
  const t = raw.trim()
  if (!t) return ''
  const passthrough = /^<!DOCTYPE\s+html/i.test(t) || /<\s*html[\s>]/i.test(t)
  if (passthrough) return injectIframeDocGuard(raw)

  const body = looksLikeEmailHtml(t)
    ? raw
    : `<div class="mail-plain-body">${escapeAndLinkifyUrls(raw)}</div>`
  return `<!DOCTYPE html><html><head>${IFRAME_FRAGMENT_HEAD}</head><body>${body}</body></html>`
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

/** Remove embedded styles/scripts and HTML comments (email HTML often has huge &lt;style&gt; blocks). */
export function stripEmailEmbeddedTags(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n')
}

/** True when the string is probably HTML from HTML→text conversion or multipart HTML bodies. */
export function looksLikeEmailHtml(s: string): boolean {
  const head = s.slice(0, 12000)
  if (/<\s*\/?\s*(html|head|body|table|tbody|thead|tr|td|div|center)\s*(?:\s|>|\/)/i.test(head)) {
    return true
  }
  const openClose = head.match(/<\s*\/?\s*[a-z][a-z0-9]{0,14}(?:\s+[^>]*|\/?)>/gi)
  if (openClose && openClose.length >= 10) return true
  return false
}

/**
 * Coarse HTML → visible text (no DOM; safe for tests in Node). Block tags become newlines, then tags stripped.
 */
export function roughHtmlToPlainText(html: string): string {
  let s = stripEmailEmbeddedTags(html)
  s = s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|table|li|section|article)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => {
      const code = parseInt(h, 16)
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
    })
  return s
}

function isCssOnlyLine(t: string): boolean {
  if (!t) return false
  if (/^@import\b/i.test(t)) return true
  if (/^@media\b/i.test(t)) return true
  if (/^@(-webkit|-moz|-ms)-/i.test(t)) return true
  if (/^@keyframes\b/i.test(t)) return true
  if (/^@font-face\b/i.test(t)) return true
  if (/^\}\s*$/.test(t)) return true
  // One-line rule: `body, a { prop: val; }` or `.x { color: red; }`
  if (/^\s*[^{}]+\{[^}]*\}\s*$/.test(t) && /:\s*[^;]+;/.test(t)) return true
  if (/^\s*[.#][\w-]+\s*\{/.test(t)) return true
  if (/^[\w-]+\s*:\s*[^;]+;\s*$/.test(t)) return true
  if (/!important/i.test(t) && /:\s*/.test(t)) return true
  return false
}

/** Drop line-oriented CSS noise often left when HTML newsletters are turned into text. */
export function stripCssLikeLines(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let blockComment = false
  for (const line of lines) {
    const t = line.trim()
    if (blockComment) {
      if (t.includes('*/')) blockComment = false
      continue
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) blockComment = true
      continue
    }
    if (isCssOnlyLine(t)) continue
    out.push(line)
  }
  return out.join('\n')
}

function isCssHeavyBlock(para: string): boolean {
  const lines = para
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return false
  if (lines.length >= 2 && lines.every((l) => isCssOnlyLine(l))) return true
  if (lines.length < 5) return false
  const hits = lines.filter((l) => isCssOnlyLine(l) || l.startsWith('/*') || l.endsWith('*/')).length
  return hits / lines.length >= 0.6
}

export function stripCssHeavyParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => !isCssHeavyBlock(p))
    .join('\n\n')
}

function normalizeMailBodyForDisplay(raw: string): string {
  let s = raw.replace(/\r\n/g, '\n').replace(/[\u200b-\u200f\ufeff]/g, '')
  s = stripEmailEmbeddedTags(s)
  if (looksLikeEmailHtml(s)) {
    s = roughHtmlToPlainText(s)
  }
  s = stripCssLikeLines(s)
  s = stripCssHeavyParagraphs(s)
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Build HTML for the inbox thread body: strip HTML/CSS noise from newsletters, then escape, linkify,
 * and add spacing between blank-line-separated blocks.
 */
export function mailBodyToDisplayHtml(body: string): string {
  const normalized = normalizeMailBodyForDisplay(body)
  if (!normalized) return ''

  const parts = normalized
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
  if (parts.length <= 1) {
    return escapeAndLinkifyUrls(normalized)
  }
  return parts.map((block) => `<p class="mail-para">${escapeAndLinkifyUrls(block)}</p>`).join('')
}
