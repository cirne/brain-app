import { isWikiRootIndexPath } from './wikiPathDisplay.js'

/** Title-case hyphenated segment (mirror of WikiFileName display rules). */
function titleCaseSegment(segment: string): string {
  return segment.split('-').map(w => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join(' ')
}

/**
 * Visible page/folder heading for a vault-relative Markdown path — the same text as WikiFileName’s
 * trailing name chip (icons and folder typography are not included).
 */
export function wikiVaultPathDisplayName(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
  const clean = normalized.replace(/\.md$/, '')
  const slash = clean.lastIndexOf('/')
  const folder = slash < 0 ? '' : clean.slice(0, slash + 1)
  const name = slash < 0 ? clean : clean.slice(slash + 1)
  const isIndex = name === '_index' || name.toLowerCase() === 'index'
  const isSpecial = name.startsWith('_') && !(isIndex && folder)

  if (isWikiRootIndexPath(normalized)) return 'My Wiki'
  if (isIndex) {
    const i = normalized.lastIndexOf('/')
    return i < 0 ? 'My Wiki' : normalized.slice(i + 1)
  }
  const base = isSpecial ? name.slice(1) : name
  return titleCaseSegment(base)
}
