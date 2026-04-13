import { marked } from 'marked'

// LLM emits [display text](date:YYYY-MM-DD); marked renders it as <a href="date:...">
// LLM emits [display text](wiki:path/to/file.md) or [text](wiki:path/to/file); marked renders it as <a href="wiki:...">
// Convert those <a> tags to interactive buttons.
const DATE_LINK_RE = /<a href="date:(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/a>/g
const WIKI_LINK_RE = /<a href="wiki:([^"]*)">([\s\S]*?)<\/a>/g

export function renderMarkdown(text: string): string {
  try {
    const html = marked(text) as string
    return html
      .replace(DATE_LINK_RE, '<button class="date-link" data-date="$1">$2</button>')
      .replace(WIKI_LINK_RE, (_, path, label) => {
        const wikiPath = path.endsWith('.md') ? path : `${path}.md`
        return `<button class="wiki-link" data-wiki="${wikiPath}">${label}</button>`
      })
  } catch {
    return text
  }
}
