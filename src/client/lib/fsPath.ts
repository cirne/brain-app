/**
 * Raw filesystem paths (vs wiki-relative paths under the repo wiki root).
 * Used for `/files/...` URLs and agent navigation to indexed/readable files.
 */

/** True for absolute POSIX paths, `~/…`, or Windows `C:\` / `C:/`. */
export function isFilesystemAbsolutePath(p: string): boolean {
  const s = p.trim()
  if (s.startsWith('/') || s.startsWith('~/')) return true
  return /^[a-zA-Z]:[\\/]/.test(s)
}

/**
 * Build a filesystem path from URL segments after `/files/` or legacy `/wiki/` when the URL pointed at disk.
 * Handles `//Users/...` (empty first segment) and macOS `/Users/...` without a leading slash in the path.
 */
export function absolutePathFromUrlSegments(rest: string[]): string {
  const dec = rest.map(s => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  if (dec.length === 0) return ''
  if (dec[0] === '' && dec.length > 1) {
    return '/' + dec.slice(1).join('/')
  }
  const roots = new Set(['Users', 'Volumes', 'private', 'System', 'home', 'mnt', 'tmp'])
  if (roots.has(dec[0])) {
    return '/' + dec.join('/')
  }
  return dec.join('/')
}

/**
 * True when `/wiki/…` URL segments should open the **file** viewer (raw disk) rather than wiki markdown.
 */
/**
 * Encode a filesystem path for `/files/…` URLs (avoids a double slash after `/files` when `path` is absolute POSIX).
 */
export function encodeFilesystemPathForUrl(path: string): string {
  const s = path.trim()
  if (!s) return ''
  const posix = s.replace(/\\/g, '/')
  const stripped = posix.replace(/^\/+/, '')
  return stripped.split('/').map(encodeURIComponent).join('/')
}

export function wikiUrlSegmentsLookLikeFilesystemPath(rest: string[]): boolean {
  if (rest.length === 0) return false
  const dec = rest.map(s => {
    try {
      return decodeURIComponent(s)
    } catch {
      return s
    }
  })
  if (dec[0] === '' && dec.length > 1) return true
  const roots = new Set(['Users', 'Volumes', 'private', 'System', 'mnt'])
  return roots.has(dec[0])
}
