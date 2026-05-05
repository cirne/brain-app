/** Detail panel target (wiki, email thread, calendar, or raw file on disk). */
export type Overlay =
  | {
      type: 'wiki'
      path?: string
      /** Owner tenant id — legacy query URLs and shared API until handle URLs fully replace. */
      shareOwner?: string
      sharePrefix?: string
      /** Sharer handle for wiki-primary path URLs `/wiki/@handle/...` (no leading `@`). */
      shareHandle?: string
    }
  /** Indexed / readable file path (absolute); raw file viewer. */
  | { type: 'file'; path?: string }
  /** Google Drive or localDir document id (ripmail `read`); {@link IndexedFileViewer}. */
  | { type: 'indexed-file'; id?: string; source?: string }
  | { type: 'email'; id?: string }
  /** Ripmail draft id (local `drafts/*.md`); editable in overlay before send. */
  | { type: 'email-draft'; id?: string }
  /** Tool-derived mail search hits kept in shell state under `id`; `query` is for URL/title fallback. */
  | { type: 'mail-search'; id?: string; query?: string }
  | { type: 'calendar'; date?: string; eventId?: string }
  /** `chat` is canonical chat_identifier (E.164, email, …) for /api/messages/thread */
  | { type: 'messages'; chat?: string }
  | { type: 'your-wiki' }
  | { type: 'hub-source'; id?: string }
  /** Brain Hub admin/settings/status main surface when hub is primary. */
  | { type: 'hub' }
  | { type: 'hub-wiki-about' }
  | {
      type: 'wiki-dir'
      path?: string
      shareOwner?: string
      sharePrefix?: string
      /** Sharer handle for wiki-primary path URLs `/wiki/@handle/...` (no leading `@`). */
      shareHandle?: string
    }
  | { type: 'chat-history' }

/** Primary surface of the current route. Absent (or `undefined`) means the default chat column (`/c`). */
export type RouteZone = 'hub' | 'settings' | 'wiki'

/**
 * Chat-first shell: optional detail overlay in `?panel=` (+ payload); base path is `/c` or `/c/{slug}--{tail}`;
 * Brain Hub primary surface is `/hub`. OAuth `/api/oauth/*` callback paths are unchanged (server).
 */
export type Route = {
  /** Server session id (UUID) when known — from cache, prior navigation, or resolved `sessionTail`. */
  sessionId?: string
  /**
   * First 12 hex chars of the session UUID when the bar has not been resolved to a full id yet.
   * Identity is this prefix; resolve via session list + `rememberChatTail`.
   */
  sessionTail?: string
  overlay?: Overlay
  flow?: 'welcome' | 'hard-reset' | 'restart-seed' | 'first-chat' | 'enron-demo'
  /**
   * Primary surface when not the default chat column.
   * `'hub'` → `/hub`, `'settings'` → `/settings`, `'wiki'` → `/wiki/…`.
   * Absent means chat (`/c`).
   */
  zone?: RouteZone
}

export type SurfaceContext =
  | { type: 'chat' }
  | { type: 'email'; threadId: string; subject: string; from: string; body?: string }
  | { type: 'wiki'; path: string; title: string }
  | { type: 'file'; path: string; title: string }
  | { type: 'indexed-file'; id: string; title: string; sourceKind: string; source?: string }
  | { type: 'calendar'; date: string; eventId?: string }
  | { type: 'inbox' }
  | { type: 'mail-search'; query: string }
  | { type: 'messages'; chat: string; displayLabel: string }
  | { type: 'wiki-dir'; path: string; title: string }
  | {
      type: 'email-draft'
      draftId: string
      subject: string
      /** Short To line for agent context */
      toLine?: string
      /** First lines of body for agent context */
      bodyPreview?: string
    }
  | { type: 'none' }

/** Serialize a SurfaceContext to a human-readable string for the agent. */
export function contextToString(ctx: SurfaceContext): string | undefined {
  if (ctx.type === 'chat') {
    return 'The user is in the main chat view (no document or email panel open).'
  }
  if (ctx.type === 'email') {
    let s = `The user is currently viewing this email (id: ${ctx.threadId}): "${ctx.subject}" from ${ctx.from}.`
    if (ctx.body) s += `\n\nEmail content:\n${ctx.body}`
    else s += ` Use the ripmail tool (e.g. read <id> --json) to load this thread if needed.`
    return s
  }
  if (ctx.type === 'wiki') return `The user is viewing doc: ${ctx.path} (title: "${ctx.title}")`
  if (ctx.type === 'wiki-dir') {
    const p = ctx.path.trim() ? ctx.path : '(wiki root)'
    return `The user is browsing wiki folder "${ctx.title}" (${p}). Listed pages and subfolders are visible.`
  }
  if (ctx.type === 'file') {
    return `The user is viewing a raw file on disk: ${ctx.path} (title: "${ctx.title}"). Use read_indexed_file with this path if you need the extracted text.`
  }
  if (ctx.type === 'indexed-file') {
    return `The user is viewing indexed file id "${ctx.id}" (${ctx.sourceKind}${ctx.title.trim() ? `: "${ctx.title}"` : ''}). Use read_indexed_file with this id if you need the content.`
  }
  if (ctx.type === 'calendar') {
    let s = `The user is viewing their calendar for ${ctx.date}`
    if (ctx.eventId) s += ` (focused event id: ${ctx.eventId})`
    return s
  }
  if (ctx.type === 'inbox') {
    return 'The user asked for a summary of the triaged inbox items in their message. Use the ripmail tool (e.g. read <id> --json, or search with --json) with the message ids provided as needed, then answer concisely.'
  }
  if (ctx.type === 'mail-search') {
    return `The user is viewing mail search results for: ${ctx.query}`
  }
  if (ctx.type === 'messages') {
    return `The user is viewing a local SMS/text thread (${ctx.displayLabel}). The canonical chat_identifier is ${ctx.chat}. Use get_message_thread with that identifier if you need more messages.`
  }
  if (ctx.type === 'email-draft') {
    let s = `The user is editing email draft id ${ctx.draftId}${ctx.subject.trim() ? `: "${ctx.subject}"` : ''}.`
    if (ctx.toLine?.trim()) s += `\nTo: ${ctx.toLine.trim()}`
    if (ctx.bodyPreview?.trim()) s += `\n\nDraft body (preview):\n${ctx.bodyPreview.trim()}`
    s +=
      '\nUse edit_draft or draft_email tools to change this draft; the overlay saves literal Markdown via the app.'
    return s
  }
  return undefined
}

const PANEL = 'panel'

/** UUID flat form prefix length in the `/c/slug--{hex}` segment (48 bits; single-user scope). */
export const CHAT_SESSION_TAIL_HEX_LEN = 12

const TAIL_MAP_KEY = 'brain.chatTailMap'

function readTailMap(): Record<string, string> {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    return JSON.parse(sessionStorage.getItem(TAIL_MAP_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function writeTailMap(m: Record<string, string>) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(TAIL_MAP_KEY, JSON.stringify(m))
  } catch {
    /* ignore quota / private mode */
  }
}

/** Remember 12-hex tail → full session id for sync `parseRoute` on reload. */
export function rememberChatTail(tail12: string, fullSessionId: string): void {
  const key = tail12.toLowerCase()
  const m = readTailMap()
  m[key] = fullSessionId
  writeTailMap(m)
}

/** Sync resolve of tail to full id when the user has visited this session in the tab. */
export function readTailFromCache(tail12: string): string | undefined {
  return readTailMap()[tail12.toLowerCase()]
}

/** True when `sessionId` is a 128-bit UUID (with or without dashes). */
export function isUuidSessionId(sessionId: string): boolean {
  const flat = sessionId.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(flat)
}

/** First words of title → kebab slug for the bar; falls back to `chat`. */
export function slugifyChatTitleForUrl(title?: string | null): string {
  const t = title?.trim()
  if (!t) return 'chat'
  const words = t.split(/\s+/).slice(0, 6).join(' ')
  let slug = words
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-')
    .slice(0, 48)
  return slug || 'chat'
}

/** `/c/:segment` for UUID sessions: `{slug}--` + first {@link CHAT_SESSION_TAIL_HEX_LEN} hex digits. */
export function chatUrlSegment(sessionId: string, chatTitle?: string | null): string {
  if (!isUuidSessionId(sessionId)) return sessionId
  const flat = sessionId.replace(/-/g, '').toLowerCase()
  const slug = slugifyChatTitleForUrl(chatTitle)
  const tail = flat.slice(0, CHAT_SESSION_TAIL_HEX_LEN)
  return `${slug}--${tail}`
}

/**
 * Parse `/c/:segment` for chat. Canonical shape: `{slug}--{12 hex}` only (no other bookmark shapes).
 * Uses {@link readTailFromCache} so repeat loads get `sessionId` synchronously.
 */
export function parseChatPathSegment(segment: string): Pick<Route, 'sessionId' | 'sessionTail'> {
  const dec = safeDecodePathSegment(segment)
  const m = dec.match(/^(.+?)--([0-9a-f]{12})$/i)
  if (!m || !m[2]) return {}
  const tail = m[2].toLowerCase()
  const cached = readTailFromCache(tail)
  if (cached) return { sessionId: cached }
  return { sessionTail: tail }
}

function safeDecodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Encode each vault-relative segment for wiki-primary `/wiki/...` URLs (no leading slash). */
export function encodeWikiPrimaryPathSegments(relPath: string): string {
  return relPath
    .split('/')
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/**
 * Personal wiki paths are `me/…` relative to `wikis/`. Normalize legacy vault-only paths from URLs/query.
 */
export function toUnifiedPersonalWikiPath(path: string | undefined): string | undefined {
  const p = path?.trim()
  if (!p) return undefined
  if (p === 'me' || p.startsWith('me/')) return p
  if (p.startsWith('@')) return p
  return `me/${p}`
}

function wikiOverlaySharing(opts: {
  shareHandle?: string
  shareOwner?: string
  sharePrefix?: string
}): boolean {
  return Boolean(opts.shareHandle?.trim() || opts.shareOwner?.trim() || opts.sharePrefix?.trim())
}

/** Normalize `panel=wiki` / `panel=wiki-dir` path query segments when not in legacy shared overlays. */
export function normalizeWikiOverlayQueryPath(
  path: string | undefined,
  opts: { shareHandle?: string; shareOwner?: string; sharePrefix?: string },
): string | undefined {
  const p = path?.trim()
  if (!p) return undefined
  if (wikiOverlaySharing(opts)) return p
  return toUnifiedPersonalWikiPath(p)
}

function wikiOverlayUsesLegacyShareQuery(o: Overlay): boolean {
  if (o.type !== 'wiki' && o.type !== 'wiki-dir') return false
  const hasLegacy = Boolean(o.shareOwner?.trim() || o.sharePrefix?.trim())
  const hasHandle = Boolean(o.shareHandle?.trim())
  return hasLegacy && !hasHandle
}

function buildWikiPrimaryUrl(
  overlay: Extract<Overlay, { type: 'wiki' } | { type: 'wiki-dir' }>,
): string {
  const h = overlay.shareHandle?.trim()
  if (h) {
    const base = `/wiki/@${encodeURIComponent(h)}`
    if (overlay.type === 'wiki-dir') {
      const p = overlay.path?.trim()
      if (!p) return `${base}/`
      return `${base}/${encodeWikiPrimaryPathSegments(p)}/`
    }
    const p = overlay.path?.trim()
    if (!p) return `${base}/`
    return `${base}/${encodeWikiPrimaryPathSegments(p)}`
  }
  if (overlay.type === 'wiki-dir') {
    const raw = overlay.path?.trim()
    if (!raw) return '/wiki/'
    const u = toUnifiedPersonalWikiPath(raw) ?? raw
    if (u === 'me') return '/wiki/me/'
    if (u.startsWith('me/')) {
      const rest = u.slice(3).replace(/\/+$/g, '')
      return rest ? `/wiki/me/${encodeWikiPrimaryPathSegments(rest)}/` : '/wiki/me/'
    }
    return `/wiki/me/${encodeWikiPrimaryPathSegments(u.replace(/\/+$/g, ''))}/`
  }
  const raw = overlay.path?.trim()
  /** Bare pathname `/wiki` is the wiki-dir hub; keep empty wiki reader addressable via `?panel=wiki`. */
  if (!raw) return '/wiki?panel=wiki'
  const u = toUnifiedPersonalWikiPath(raw) ?? raw
  if (u.startsWith('@')) return `/wiki/${encodeWikiPrimaryPathSegments(u)}`
  if (u === 'me') return '/wiki/me/'
  if (u.startsWith('me/')) {
    return `/wiki/me/${encodeWikiPrimaryPathSegments(u.slice(3))}`
  }
  return `/wiki/me/${encodeWikiPrimaryPathSegments(u)}`
}

/**
 * Path segments after `wiki` / `wikis` (`['me','ideas','a.md']`, `['@cirne','travel']`, …), split on `/`.
 */
function parseWikiPrimaryPathname(
  href: string,
  wikiRest: string[],
): { zone: 'wiki'; overlay: Overlay } {
  const url = new URL(href, 'http://localhost')
  const pathnameEndsWithSlash = url.pathname.endsWith('/')
  const decoded = wikiRest.map((s) => safeDecodePathSegment(s))

  const first = decoded[0] ?? ''
  if (first === 'me' || first === 'my-wiki') {
    const relSegs = decoded.slice(1)
    const vaultRel = relSegs.join('/')
    const lastSeg = relSegs[relSegs.length - 1] ?? ''

    if (relSegs.length === 0) {
      return { zone: 'wiki', overlay: { type: 'wiki-dir', path: 'me' } }
    }

    const unifiedPath = `me/${vaultRel}`
    const isFile = lastSeg.endsWith('.md') && !pathnameEndsWithSlash
    if (isFile) {
      return { zone: 'wiki', overlay: { type: 'wiki', path: unifiedPath } }
    }

    const dirPath = unifiedPath.replace(/\/+$/g, '') || undefined
    return { zone: 'wiki', overlay: { type: 'wiki-dir', path: dirPath } }
  }
  if (first.startsWith('@')) {
    const shareHandle = first.slice(1).trim()
    if (!shareHandle) {
      return { zone: 'wiki', overlay: { type: 'wiki' } }
    }

    const relSegs = decoded.slice(1)
    const relPath = relSegs.join('/')
    const lastSeg = relSegs[relSegs.length - 1] ?? ''

    if (relSegs.length === 0) {
      return { zone: 'wiki', overlay: { type: 'wiki-dir', shareHandle } }
    }

    const isFile = lastSeg.endsWith('.md') && !pathnameEndsWithSlash
    if (isFile) {
      return {
        zone: 'wiki',
        overlay: { type: 'wiki', path: relPath, shareHandle },
      }
    }

    const dirPath = relPath.replace(/\/+$/g, '') || undefined
    return {
      zone: 'wiki',
      overlay: { type: 'wiki-dir', path: dirPath, shareHandle },
    }
  }

  const relPath = decoded.join('/')
  const unifiedPersonal = toUnifiedPersonalWikiPath(relPath) ?? relPath
  const lastSeg = unifiedPersonal.split('/').pop() ?? ''

  const isFile = lastSeg.endsWith('.md') && !pathnameEndsWithSlash
  if (isFile) {
    return { zone: 'wiki', overlay: { type: 'wiki', path: unifiedPersonal } }
  }

  const dirPath = unifiedPersonal.replace(/\/+$/g, '') || undefined
  return {
    zone: 'wiki',
    overlay: { type: 'wiki-dir', path: dirPath },
  }
}

function overlayToSearchParams(overlay: Overlay): URLSearchParams {
  const q = new URLSearchParams()
  if (overlay.type === 'hub') {
    return q
  }
  q.set(PANEL, overlay.type)
  switch (overlay.type) {
    case 'wiki': {
      const normalized = normalizeWikiOverlayQueryPath(overlay.path, overlay)
      if (normalized) q.set('path', normalized)
      if (overlay.shareOwner) q.set('shareOwner', overlay.shareOwner)
      if (overlay.sharePrefix) q.set('sharePrefix', overlay.sharePrefix)
      if (overlay.shareHandle) q.set('shareHandle', overlay.shareHandle)
      break
    }
    case 'wiki-dir': {
      const normalized = normalizeWikiOverlayQueryPath(overlay.path, overlay)
      if (normalized) q.set('path', normalized)
      if (overlay.shareOwner) q.set('shareOwner', overlay.shareOwner)
      if (overlay.sharePrefix) q.set('sharePrefix', overlay.sharePrefix)
      if (overlay.shareHandle) q.set('shareHandle', overlay.shareHandle)
      break
    }
    case 'file':
      if (overlay.path) q.set('file', overlay.path)
      break
    case 'indexed-file':
      if (overlay.id) q.set('idx', overlay.id)
      if (overlay.source) q.set('src', overlay.source)
      break
    case 'email':
      if (overlay.id) q.set('m', overlay.id)
      break
    case 'email-draft':
      if (overlay.id) q.set('draft', overlay.id)
      break
    case 'mail-search':
      if (overlay.id) q.set('s', overlay.id)
      if (overlay.query) q.set('q', overlay.query)
      break
    case 'calendar':
      if (overlay.date) q.set('date', overlay.date)
      if (overlay.eventId) q.set('event', overlay.eventId)
      break
    case 'messages':
      if (overlay.chat) q.set('c', overlay.chat)
      break
    case 'hub-source':
      if (overlay.id) q.set('id', overlay.id)
      break
    default:
      break
  }
  return q
}

function overlayFromSearchParams(sp: URLSearchParams): Overlay | undefined {
  const panel = sp.get(PANEL)
  if (!panel) return undefined
  switch (panel) {
    case 'wiki': {
      const pathRaw = sp.get('path')?.trim() || undefined
      const shareOwner = sp.get('shareOwner')?.trim() || undefined
      const sharePrefix = sp.get('sharePrefix')?.trim() || undefined
      const shareHandle = sp.get('shareHandle')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw, { shareOwner, sharePrefix, shareHandle })
      const extra = {
        ...(shareOwner ? { shareOwner } : {}),
        ...(sharePrefix ? { sharePrefix } : {}),
        ...(shareHandle ? { shareHandle } : {}),
      }
      return path ? { type: 'wiki', path, ...extra } : { type: 'wiki', ...extra }
    }
    case 'wiki-dir': {
      const pathRaw = sp.get('path')?.trim() || undefined
      const shareOwner = sp.get('shareOwner')?.trim() || undefined
      const sharePrefix = sp.get('sharePrefix')?.trim() || undefined
      const shareHandle = sp.get('shareHandle')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw, { shareOwner, sharePrefix, shareHandle })
      const extra = {
        ...(shareOwner ? { shareOwner } : {}),
        ...(sharePrefix ? { sharePrefix } : {}),
        ...(shareHandle ? { shareHandle } : {}),
      }
      return path ? { type: 'wiki-dir', path, ...extra } : { type: 'wiki-dir', ...extra }
    }
    case 'file': {
      const file = sp.get('file')?.trim() || undefined
      return file ? { type: 'file', path: file } : { type: 'file' }
    }
    case 'indexed-file': {
      const idx = sp.get('idx')?.trim() || undefined
      const src = sp.get('src')?.trim() || undefined
      if (!idx) return { type: 'indexed-file' }
      return src ? { type: 'indexed-file', id: idx, source: src } : { type: 'indexed-file', id: idx }
    }
    case 'email': {
      const id = sp.get('m') ?? sp.get('id') ?? undefined
      return id ? { type: 'email', id } : { type: 'email' }
    }
    case 'email-draft': {
      const draft = sp.get('draft')?.trim() || undefined
      return draft ? { type: 'email-draft', id: draft } : { type: 'email-draft' }
    }
    case 'mail-search': {
      const id = sp.get('s')?.trim() || undefined
      const query = sp.get('q')?.trim() || undefined
      return id || query ? { type: 'mail-search', ...(id ? { id } : {}), ...(query ? { query } : {}) } : { type: 'mail-search' }
    }
    case 'calendar': {
      const date = sp.get('date') ?? undefined
      const eventId = sp.get('event') ?? undefined
      if (!date) return { type: 'calendar' }
      return { type: 'calendar', date, ...(eventId ? { eventId } : {}) }
    }
    case 'messages': {
      const c = sp.get('c') ?? undefined
      return c ? { type: 'messages', chat: c } : { type: 'messages' }
    }
    case 'your-wiki':
      return { type: 'your-wiki' }
    case 'chat-history':
      return { type: 'chat-history' }
    case 'hub-source': {
      const id = sp.get('id') ?? undefined
      return id ? { type: 'hub-source', id } : { type: 'hub-source' }
    }
    case 'hub-wiki-about':
      return { type: 'hub-wiki-about' }
    case 'hub':
      return { type: 'hub' }
    default:
      return undefined
  }
}

function hubRouteFromSearch(href: string): Route | null {
  const url = new URL(href, 'http://localhost')
  if (url.pathname !== '/hub') {
    return null
  }
  const overlay = overlayFromSearchParams(url.searchParams)
  if (!overlay) {
    return { zone: 'hub' }
  }
  return { zone: 'hub', overlay }
}

function settingsRouteFromSearch(href: string): Route | null {
  const url = new URL(href, 'http://localhost')
  if (url.pathname !== '/settings') {
    return null
  }
  const overlay = overlayFromSearchParams(url.searchParams)
  if (!overlay) {
    return { zone: 'settings' }
  }
  return { zone: 'settings', overlay }
}

export type RouteUrlOpts = {
  /** Cosmetic slug source for UUID sessions (`{slug}--{12 hex}`). */
  chatTitleForUrl?: string | null
}

function chatBasePath(route: Pick<Route, 'sessionId' | 'sessionTail'>, urlOpts?: RouteUrlOpts): string {
  if (route.sessionId) {
    const seg = chatUrlSegment(route.sessionId, urlOpts?.chatTitleForUrl)
    return `/c/${encodeURIComponent(seg)}`
  }
  const tailRaw = route.sessionTail?.trim()
  if (tailRaw) {
    const tail = tailRaw.replace(/[^0-9a-f]/gi, '').toLowerCase()
    if (tail.length >= CHAT_SESSION_TAIL_HEX_LEN) {
      const tail12 = tail.slice(0, CHAT_SESSION_TAIL_HEX_LEN)
      const slug = slugifyChatTitleForUrl(urlOpts?.chatTitleForUrl)
      return `/c/${encodeURIComponent(`${slug}--${tail12}`)}`
    }
  }
  return '/c'
}

/** Parse a URL (defaults to current location) into a Route. */
export function parseRoute(href: string = location.href): Route {
  const url = new URL(href, 'http://localhost')
  const [, seg1, ...rest] = url.pathname.split('/')

  if (seg1 === 'welcome' || seg1 === 'onboarding') {
    return { flow: 'welcome' }
  }
  if (seg1 === 'hard-reset') {
    return { flow: 'hard-reset' }
  }
  if (seg1 === 'restart-seed') {
    return { flow: 'restart-seed' }
  }
  if (seg1 === 'first-chat') {
    return { flow: 'first-chat' }
  }
  if (seg1 === 'demo') {
    const first = rest[0]
    if (first === undefined || first === '') {
      return { flow: 'enron-demo' }
    }
  }

  const hubParsed = hubRouteFromSearch(href)
  if (hubParsed) {
    return hubParsed
  }

  const settingsParsed = settingsRouteFromSearch(href)
  if (settingsParsed) {
    return settingsParsed
  }

  if (seg1 === 'wiki' || seg1 === 'wikis') {
    const pathParts = url.pathname.split('/').filter(Boolean)
    const wikiRest = pathParts.slice(1)

    if (wikiRest.length > 0) {
      return parseWikiPrimaryPathname(href, wikiRest)
    }

    const sp = url.searchParams
    const panel = sp.get(PANEL)?.trim()
    const shareHandleOnly = sp.get('shareHandle')?.trim() || undefined
    if (panel === 'wiki-dir') {
      const pathRaw = sp.get('path')?.trim() || undefined
      const shareOwner = sp.get('shareOwner')?.trim() || undefined
      const sharePrefix = sp.get('sharePrefix')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw, {
        shareOwner,
        sharePrefix,
        shareHandle: shareHandleOnly,
      })
      const base = path ? { type: 'wiki-dir' as const, path } : { type: 'wiki-dir' as const }
      const extra = {
        ...(shareOwner ? { shareOwner } : {}),
        ...(sharePrefix ? { sharePrefix } : {}),
        ...(shareHandleOnly ? { shareHandle: shareHandleOnly } : {}),
      }
      return {
        zone: 'wiki',
        overlay: { ...base, ...extra },
      }
    }
    if (panel === 'wiki') {
      const pathRaw = sp.get('path')?.trim() || undefined
      const shareOwner = sp.get('shareOwner')?.trim() || undefined
      const sharePrefix = sp.get('sharePrefix')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw, {
        shareOwner,
        sharePrefix,
        shareHandle: shareHandleOnly,
      })
      const base = path ? { type: 'wiki' as const, path } : { type: 'wiki' as const }
      const extra = {
        ...(shareOwner ? { shareOwner } : {}),
        ...(sharePrefix ? { sharePrefix } : {}),
        ...(shareHandleOnly ? { shareHandle: shareHandleOnly } : {}),
      }
      return {
        zone: 'wiki',
        overlay: { ...base, ...extra },
      }
    }
    const pathOnlyRaw = sp.get('path')?.trim()
    const shareOwnerOnly = sp.get('shareOwner')?.trim() || undefined
    const sharePrefixOnly = sp.get('sharePrefix')?.trim() || undefined
    const pathOnly = normalizeWikiOverlayQueryPath(pathOnlyRaw, {
      shareOwner: shareOwnerOnly,
      sharePrefix: sharePrefixOnly,
      shareHandle: shareHandleOnly,
    })
    if (pathOnly) {
      return {
        zone: 'wiki',
        overlay: {
          type: 'wiki',
          path: pathOnly,
          ...(shareOwnerOnly ? { shareOwner: shareOwnerOnly } : {}),
          ...(sharePrefixOnly ? { sharePrefix: sharePrefixOnly } : {}),
          ...(shareHandleOnly ? { shareHandle: shareHandleOnly } : {}),
        },
      }
    }
    if (shareOwnerOnly) {
      return {
        zone: 'wiki',
        overlay: {
          type: 'wiki',
          shareOwner: shareOwnerOnly,
          ...(sharePrefixOnly ? { sharePrefix: sharePrefixOnly } : {}),
          ...(shareHandleOnly ? { shareHandle: shareHandleOnly } : {}),
        },
      }
    }
    if (shareHandleOnly) {
      return {
        zone: 'wiki',
        overlay: { type: 'wiki-dir', shareHandle: shareHandleOnly },
      }
    }
    return { zone: 'wiki', overlay: { type: 'wiki-dir' } }
  }

  if (seg1 === 'c') {
    const chatPart =
      rest.length > 0 && rest[0] ? parseChatPathSegment(rest[0]) : {}
    const overlay = overlayFromSearchParams(url.searchParams)
    const base: Route = { ...chatPart }
    if (overlay) return { ...base, overlay }
    return base
  }

  if (seg1 === '' || seg1 === undefined) {
    const overlay = overlayFromSearchParams(url.searchParams)
    if (overlay) return { overlay }
    return {}
  }

  return {}
}

/** Convert a Route back to a URL string (path + `?panel=…` only; preserves no other query — see Hub OAuth banners). */
export function routeToUrl(route: Route, urlOpts?: RouteUrlOpts): string {
  if (route.flow === 'welcome') return '/welcome'
  if (route.flow === 'hard-reset') return '/hard-reset'
  if (route.flow === 'restart-seed') return '/restart-seed'
  if (route.flow === 'first-chat') return '/first-chat'
  if (route.flow === 'enron-demo') return '/demo'

  const zone = route.zone
  const o = route.overlay

  if (zone === 'wiki') {
    if (!o) {
      return '/wiki'
    }
    if (o.type === 'wiki' || o.type === 'wiki-dir') {
      if (wikiOverlayUsesLegacyShareQuery(o)) {
        const q = new URLSearchParams()
        if (o.path) q.set('path', o.path)
        if (o.shareOwner) q.set('shareOwner', o.shareOwner)
        if (o.sharePrefix) q.set('sharePrefix', o.sharePrefix)
        if (o.type === 'wiki-dir') q.set(PANEL, 'wiki-dir')
        const qs = q.toString()
        return qs ? `/wiki?${qs}` : '/wiki'
      }
      return buildWikiPrimaryUrl(o)
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/wiki?${qs}` : '/wiki'
  }

  if (zone === 'hub') {
    if (!o || o.type === 'hub') {
      return '/hub'
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/hub?${qs}` : '/hub'
  }

  if (zone === 'settings') {
    if (!o || o.type === 'hub') {
      return '/settings'
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/settings?${qs}` : '/settings'
  }

  const chatPath = chatBasePath(
    { sessionId: route.sessionId, sessionTail: route.sessionTail },
    urlOpts,
  )

  if (!o) {
    return chatPath
  }

  if (o.type === 'hub') {
    return chatPath
  }

  const q = overlayToSearchParams(o)
  const qs = q.toString()
  const base = chatPath
  return qs ? `${base}?${qs}` : base
}

export type NavigateOptions = {
  /**
   * Use `history.replaceState` instead of `pushState`. Prefer when leaving an
   * overlay for chat-only so ⌫/⌥← does not immediately restore the closed panel
   * (same URL stack entry is updated instead of pushing a second `/c` on top of a detail URL).
   */
  replace?: boolean
  /** See {@link RouteUrlOpts.chatTitleForUrl}. */
  chatTitleForUrl?: string | null
}

/** Push (or replace) the route in the browser address bar and history stack. */
export function navigate(route: Route, opts?: NavigateOptions): void {
  const url = routeToUrl(route, {
    chatTitleForUrl: opts?.chatTitleForUrl,
  })
  if (route.sessionId && isUuidSessionId(route.sessionId)) {
    const flat = route.sessionId.replace(/-/g, '').toLowerCase()
    rememberChatTail(flat.slice(0, CHAT_SESSION_TAIL_HEX_LEN), route.sessionId)
  }
  if (opts?.replace) {
    history.replaceState(null, '', url)
  } else {
    history.pushState(null, '', url)
  }
}
