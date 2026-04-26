import { readdir } from 'node:fs/promises'

/**
 * Hardcoded allowlist: only these vault-root `*.md` paths may be created or replaced by agent
 * `write` / `move_file` (single path segment at the wiki root). Every other markdown file must use
 * a subdirectory (e.g. `topics/note.md`). Expand this tuple when product policy adds more root
 * files; keep it defined only here.
 */
export const AGENT_ALLOWED_WIKI_ROOT_MARKDOWN = ['index.md', 'me.md'] as const

const ALLOWED_ROOT_MARKDOWN = new Set(
  (AGENT_ALLOWED_WIKI_ROOT_MARKDOWN as readonly string[]).map((s) => s.toLowerCase()),
)

/**
 * True when `rel` is a single path segment ending in `.md` (vault root), after normalizing slashes.
 */
export function isWikiVaultRootMarkdownPath(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/').trim()
  const segments = norm.split('/').filter((s) => s.length > 0 && s !== '.')
  if (segments.length !== 1) return false
  return segments[0]!.toLowerCase().endsWith('.md')
}

/**
 * True when an agent `write` (or move destination) to `resolvedRelPath` should be rejected
 * because it would place a disallowed markdown file at the vault root.
 */
export function isAgentWikiRootMarkdownWriteBlocked(resolvedRelPath: string): boolean {
  if (!isWikiVaultRootMarkdownPath(resolvedRelPath)) return false
  const leaf = resolvedRelPath.replace(/\\/g, '/').trim().split('/').filter(Boolean).pop() ?? ''
  return !ALLOWED_ROOT_MARKDOWN.has(leaf.toLowerCase())
}

export async function listWikiTopLevelDirectories(wikiDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(wikiDir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Throws if the resolved wiki-relative path is a disallowed vault-root `.md` file.
 */
export async function assertAgentWikiWriteUsesSubdirectory(
  wikiDir: string,
  resolvedRelPath: string,
): Promise<void> {
  if (!isAgentWikiRootMarkdownWriteBlocked(resolvedRelPath)) return
  const dirs = await listWikiTopLevelDirectories(wikiDir)
  const list =
    dirs.length > 0
      ? dirs.join(', ')
      : '(none yet — include a folder in the path, e.g. notes/page.md)'
  const example = dirs.length > 0 ? `${dirs[0]}/your-note.md` : 'notes/your-note.md'
  throw new Error(
    `This tool must use a path under a subdirectory of the wiki, not a top-level .md file next to the vault root. ` +
      `Available top-level directories: ${list}. ` +
      `Example: \`${example}\` (you may create new folders in the path when appropriate).`,
  )
}
