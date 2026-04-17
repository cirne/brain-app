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

// LLM emits [display text](date:YYYY-MM-DD); marked renders it as <a href="date:...">
// LLM emits [display text](wiki:path) → marked → transformWikiPageHtml turns wiki: + [[wikilinks]] into data-wiki links.
const DATE_LINK_RE = /<a href="date:(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/a>/g

/**
 * Markdown body (no YAML front matter) → HTML: `marked` + Obsidian `[[links]]` + `wiki:` href handling.
 * Use this anywhere we show markdown as HTML (chat, wiki cards, TipTap editor) so wikilinks behave consistently.
 */
export function renderMarkdownBody(body: string): string {
  const html = marked(body) as string
  return transformWikiPageHtml(html)
}

export function renderMarkdown(text: string): string {
  try {
    const body = stripFrontMatter(text)
    const withWiki = renderMarkdownBody(body)
    return withWiki.replace(DATE_LINK_RE, '<button class="date-link" data-date="$1">$2</button>')
  } catch {
    return text
  }
}
