/** Detail panel target (wiki, email thread, calendar, or raw file on disk). */
export type Overlay =
  | { type: 'wiki'; path?: string }
  /** Indexed / readable file path (absolute); raw file viewer. */
  | { type: 'file'; path?: string }
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
  | { type: 'hub-add-folders' }
  | { type: 'hub-apple-messages' }
  /** Brain Hub admin/settings/status main surface when hub is primary. */
  | { type: 'hub' }
  | { type: 'hub-wiki-about' }
  | { type: 'phone-access' }
  | { type: 'wiki-dir'; path?: string }
  | { type: 'chat-history' }

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
  /** True when primary surface is Brain Hub (`/hub`). */
  hubActive?: boolean
  /** True when primary surface is wiki-first (`/wiki`, optional `?path=`). */
  wikiActive?: boolean
}

export type SurfaceContext =
  | { type: 'chat' }
  | { type: 'email'; threadId: string; subject: string; from: string; body?: string }
  | { type: 'wiki'; path: string; title: string }
  | { type: 'file'; path: string; title: string }
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
    return `The user is viewing a raw file on disk: ${ctx.path} (title: "${ctx.title}"). Use read_email with this path if you need the extracted text.`
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

function overlayToSearchParams(overlay: Overlay): URLSearchParams {
  const q = new URLSearchParams()
  if (overlay.type === 'hub') {
    return q
  }
  q.set(PANEL, overlay.type)
  switch (overlay.type) {
    case 'wiki':
      if (overlay.path) q.set('path', overlay.path)
      break
    case 'wiki-dir':
      if (overlay.path) q.set('path', overlay.path)
      break
    case 'file':
      if (overlay.path) q.set('file', overlay.path)
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
      const path = sp.get('path')?.trim() || undefined
      return path ? { type: 'wiki', path } : { type: 'wiki' }
    }
    case 'wiki-dir': {
      const path = sp.get('path')?.trim() || undefined
      return path ? { type: 'wiki-dir', path } : { type: 'wiki-dir' }
    }
    case 'file': {
      const file = sp.get('file')?.trim() || undefined
      return file ? { type: 'file', path: file } : { type: 'file' }
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
    case 'hub-add-folders':
      return { type: 'hub-add-folders' }
    case 'hub-apple-messages':
      return { type: 'hub-apple-messages' }
    case 'phone-access':
      return { type: 'phone-access' }
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
    return { hubActive: true }
  }
  return { hubActive: true, overlay }
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

  if (seg1 === 'wiki') {
    /** Reject path-shaped `/wiki/.../file` (use `/wiki?path=`). */
    if (rest.some((s) => String(s).length > 0)) {
      return {}
    }
    const sp = url.searchParams
    const panel = sp.get(PANEL)?.trim()
    if (panel === 'wiki-dir') {
      const path = sp.get('path')?.trim() || undefined
      return { wikiActive: true, overlay: path ? { type: 'wiki-dir', path } : { type: 'wiki-dir' } }
    }
    if (panel === 'wiki') {
      const path = sp.get('path')?.trim() || undefined
      return { wikiActive: true, overlay: path ? { type: 'wiki', path } : { type: 'wiki' } }
    }
    const pathOnly = sp.get('path')?.trim()
    if (pathOnly) {
      return { wikiActive: true, overlay: { type: 'wiki', path: pathOnly } }
    }
    return { wikiActive: true, overlay: { type: 'wiki' } }
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

  const wikiActive = route.wikiActive === true
  const o = route.overlay

  if (wikiActive) {
    if (!o || o.type === 'wiki') {
      const path = o?.type === 'wiki' ? o.path?.trim() : undefined
      if (path) {
        return `/wiki?path=${encodeURIComponent(path)}`
      }
      return '/wiki'
    }
    if (o.type === 'wiki-dir') {
      const q = overlayToSearchParams(o)
      return `/wiki?${q.toString()}`
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/wiki?${qs}` : '/wiki'
  }

  const hubActive = route.hubActive === true

  if (hubActive) {
    if (!o || o.type === 'hub') {
      return '/hub'
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/hub?${qs}` : '/hub'
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
