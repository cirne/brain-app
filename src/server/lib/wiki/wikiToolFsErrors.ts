/** Node-style fs error shape (avoid `NodeJS` global for eslint no-undef in server tsconfig). */
type ErrnoLike = Error & { code?: string }

/**
 * Map Node fs errors from wiki tool execution to messages that never echo absolute paths.
 */
export function sanitizeWikiFilesystemToolError(wikiRelToolPath: string, err: unknown): Error {
  const display = wikiRelToolPath.trim().replace(/^\.\//, '').replace(/\\/g, '/') || '.'
  const code =
    err != null && typeof err === 'object' && 'code' in err
      ? String((err as ErrnoLike).code ?? '')
      : ''

  if (code === 'ENOENT') {
    const e = new Error(`ENOENT: no such file or directory (wiki path: ${display})`)
    ;(e as ErrnoLike).code = 'ENOENT'
    return e
  }
  if (code === 'EACCES' || code === 'EPERM') {
    const e = new Error(`Permission denied (wiki path: ${display})`)
    ;(e as ErrnoLike).code = code
    return e
  }
  if (code === 'EISDIR') {
    const e = new Error(`Path is a directory, not a file (wiki path: ${display})`)
    ;(e as ErrnoLike).code = 'EISDIR'
    return e
  }

  const fallback = new Error(`Wiki file operation failed (wiki path: ${display})`)
  if (code) (fallback as ErrnoLike).code = code
  return fallback
}
