import matter from 'gray-matter'
import { marked } from 'marked'
import { transformWikiPageHtml } from './wikiPageHtml.js'

/** Default line cap for wiki tool preview cards in chat. */
export const WIKI_PREVIEW_MAX_LINES = 8

/**
 * Remove YAML front matter (first `---` through a closing `---` line) from wiki body text.
 * If there is no valid closing delimiter, returns the original string.
 */
export function stripFrontMatter(text: string): string {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2 || lines[0].trim() !== '---') return text
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n').replace(/^\n+/, '')
    }
  }
  return text
}

/** Split leading YAML front matter (`---` … `---`) from the body. If none, `frontMatter` is null and `body` is the full text. */
export function splitYamlFrontMatter(text: string): { frontMatter: string | null; body: string } {
  const lines = text.split(/\r?\n/)
  if (lines.length < 2 || lines[0].trim() !== '---') {
    return { frontMatter: null, body: text }
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      const fm = lines.slice(0, i + 1).join('\n')
      const body = lines.slice(i + 1).join('\n').replace(/^\n+/, '')
      return { frontMatter: fm, body }
    }
  }
  return { frontMatter: null, body: text }
}

/** Rejoin YAML front matter and markdown body for saving (single trailing newline). */
export function joinYamlFrontMatter(frontMatter: string | null, body: string): string {
  const b = body.replace(/\s+$/, '')
  if (!frontMatter) return `${b}\n`
  return `${frontMatter}\n\n${b}\n`
}

/** First `maxLines` lines (keeps short previews bounded). */
export function takeFirstLines(text: string, maxLines: number): string {
  if (maxLines <= 0) return ''
  const lines = text.split(/\r?\n/)
  return lines.slice(0, maxLines).join('\n')
}

// Legacy: [text](date:YYYY-MM-DD) still becomes <a href="date:…"> from marked; transformWikiPageHtml rewrites to buttons.
// Safety net if any <a href="date:…"> remains after the wiki transform pass.
const DATE_LINK_RE = /<a href="date:(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/a>/g

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function applyDateLinkButtons(html: string): string {
  return html.replace(
    DATE_LINK_RE,
    '<button type="button" class="date-link" data-date="$1">$2</button>',
  )
}

/** Renders a visible header for product-feedback issue markdown (bug/feature + title; optional appHint). DRY: single place for chat + wiki `renderMarkdown`. */
export function buildFeedbackIssueHeaderHtml(input: { kind: 'bug' | 'feature'; title: string; appHint?: string }): string {
  const label = input.kind === 'bug' ? 'Bug' : 'Feature'
  const typeClass = input.kind === 'bug' ? 'md-fm-type--bug' : 'md-fm-type--feature'
  const hint =
    input.appHint?.trim() ?
      `<div class="md-fm-hint">${escapeHtml(input.appHint.trim())}</div>`
    : ''
  return (
    `<div class="md-fm-meta" role="group" aria-label="Feedback issue">` +
    `<span class="md-fm-type ${typeClass}">${label}</span>` +
    `<div class="md-fm-title">${escapeHtml(input.title.trim())}</div>` +
    `${hint}</div>`
  )
}

function feedbackHeaderFromMatterData(data: Record<string, unknown>): string | null {
  const t = data.type
  const title = data.title
  if (typeof t !== 'string' || typeof title !== 'string' || !title.trim()) return null
  const kind = t.trim().toLowerCase()
  if (kind !== 'bug' && kind !== 'feature') return null
  const hint = typeof data.appHint === 'string' ? data.appHint : undefined
  return buildFeedbackIssueHeaderHtml({ kind: kind as 'bug' | 'feature', title, appHint: hint })
}

const INLINE_BUG_FEATURE_TITLE_RE = /^type:\s*(bug|feature)\s+title:\s*(.+)$/i

/** When the model omits `---` and emits one line: `type: bug title: …` */
function trySplitInlineFeedbackLead(body: string): { header: string; rest: string } | null {
  const lines = body.split(/\r?\n/)
  const first = (lines[0] ?? '').trim()
  const m = first.match(INLINE_BUG_FEATURE_TITLE_RE)
  if (!m) return null
  const kind = m[1].toLowerCase() as 'bug' | 'feature'
  const title = m[2].trim()
  if (!title) return null
  const rest = lines.slice(1).join('\n').replace(/^\n+/, '')
  return { header: buildFeedbackIssueHeaderHtml({ kind, title }), rest }
}

/**
 * Markdown body (no YAML front matter) → HTML: `marked` + Obsidian `[[links]]` + internal path / date handling.
 * Use this anywhere we show markdown as HTML (chat, wiki cards, TipTap editor) so wikilinks behave consistently.
 */
export function renderMarkdownBody(body: string): string {
  const html = marked(body) as string
  return transformWikiPageHtml(html)
}

export function renderMarkdown(text: string): string {
  try {
    let body: string
    let header: string | null = null
    try {
      const { data, content } = matter(text)
      body = content
      header = feedbackHeaderFromMatterData(data as Record<string, unknown>)
    } catch {
      body = stripFrontMatter(text)
    }
    if (!header) {
      const split = trySplitInlineFeedbackLead(body)
      if (split) {
        header = split.header
        body = split.rest
      }
    }
    return (header ?? '') + applyDateLinkButtons(renderMarkdownBody(body))
  } catch {
    return text
  }
}
