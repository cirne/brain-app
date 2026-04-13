/**
 * Server wiki pages use `marked()` only; `[label](wiki:path)` becomes `<a href="wiki:...">`.
 * In-app navigation and WikiFileName mounts expect `data-wiki` + `href="#"`.
 */

export function normalizeWikiPathForMatch(ref: string): string {
  return ref
    .trim()
    .replace(/^\/+/, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
}

/**
 * - `[[path|label]]` Obsidian-style wikilinks
 * - `<a href="wiki:path">label</a>` from markdown `[label](wiki:path)`
 */
export function transformWikiPageHtml(html: string): string {
  let out = html.replace(/\[\[([^\]]+)\]\]/g, (_, inner: string) => {
    const [path, label] = inner.split('|')
    const display = (label ?? path).trim()
    return `<a href="#" data-wiki="${path.trim()}" class="wiki-link">${display}</a>`
  })
  out = out.replace(
    /<a href="wiki:([^"]+)">([\s\S]*?)<\/a>/gi,
    (_, rawPath: string, label: string) => {
      let p = rawPath.trim()
      if (!p.endsWith('.md')) p = `${p}.md`
      return `<a href="#" data-wiki="${p}" class="wiki-link">${label}</a>`
    },
  )
  return out
}
