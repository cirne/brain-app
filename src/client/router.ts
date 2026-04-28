/** Detail panel target (wiki, email thread, calendar, or raw file on disk). */
export type Overlay =
  | { type: 'wiki'; path?: string }
  /** Indexed / readable file path (absolute); raw file viewer. */
  | { type: 'file'; path?: string }
  | { type: 'email'; id?: string }
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
 * Chat-first shell: optional detail overlay in `?panel=` (+ payload); base path is `/c` or `/c/:sessionId`;
 * Brain Hub primary surface is `/hub`. OAuth `/api/oauth/*` callback paths are unchanged (server).
 */
export type Route = {
  /** Server chat session id when URL is `/c/:sessionId`; omitted on `/c` (new / no id in bar). */
  sessionId?: string
  overlay?: Overlay
  flow?: 'welcome' | 'hard-reset' | 'restart-seed' | 'first-chat' | 'enron-demo'
  /** True when primary surface is Brain Hub (`/hub`). */
  hubActive?: boolean
}

export type SurfaceContext =
  | { type: 'chat' }
  | { type: 'email'; threadId: string; subject: string; from: string; body?: string }
  | { type: 'wiki'; path: string; title: string }
  | { type: 'file'; path: string; title: string }
  | { type: 'calendar'; date: string; eventId?: string }
  | { type: 'inbox' }
  | { type: 'messages'; chat: string; displayLabel: string }
  | { type: 'wiki-dir'; path: string; title: string }
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
  if (ctx.type === 'messages') {
    return `The user is viewing a local SMS/text thread (${ctx.displayLabel}). The canonical chat_identifier is ${ctx.chat}. Use get_message_thread with that identifier if you need more messages.`
  }
  return undefined
}

const PANEL = 'panel'

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

function chatBasePath(sessionId?: string): string {
  if (sessionId) return `/c/${encodeURIComponent(sessionId)}`
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

  if (seg1 === 'c') {
    const sessionId =
      rest.length > 0 && rest[0] ? safeDecodePathSegment(rest[0]) : undefined
    const overlay = overlayFromSearchParams(url.searchParams)
    const base: Route = { ...(sessionId ? { sessionId } : {}) }
    if (overlay) return { ...base, overlay }
    return base
  }

  if (seg1 === 'chat' || seg1 === 'home') {
    const overlay = overlayFromSearchParams(url.searchParams)
    if (overlay) return { overlay }
    return {}
  }

  if (seg1 === '' || seg1 === undefined) {
    const overlay = overlayFromSearchParams(url.searchParams)
    if (overlay) return { overlay }
    return {}
  }

  return {}
}

/** Convert a Route back to a URL string (path + `?panel=…` only; preserves no other query — see Hub OAuth banners). */
export function routeToUrl(route: Route): string {
  if (route.flow === 'welcome') return '/welcome'
  if (route.flow === 'hard-reset') return '/hard-reset'
  if (route.flow === 'restart-seed') return '/restart-seed'
  if (route.flow === 'first-chat') return '/first-chat'
  if (route.flow === 'enron-demo') return '/demo'

  const hubActive = route.hubActive === true
  const o = route.overlay

  if (hubActive) {
    if (!o || o.type === 'hub') {
      return '/hub'
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/hub?${qs}` : '/hub'
  }

  if (!o) {
    return chatBasePath(route.sessionId)
  }

  if (o.type === 'hub') {
    return chatBasePath(route.sessionId)
  }

  const q = overlayToSearchParams(o)
  const qs = q.toString()
  const base = chatBasePath(route.sessionId)
  return qs ? `${base}?${qs}` : base
}

export type NavigateOptions = {
  /**
   * Use `history.replaceState` instead of `pushState`. Prefer when leaving an
   * overlay for chat-only so ⌫/⌥← does not immediately restore the closed panel
   * (same URL stack entry is updated instead of pushing a second `/c` on top of a detail URL).
   */
  replace?: boolean
}

/** Push (or replace) the route in the browser address bar and history stack. */
export function navigate(route: Route, opts?: NavigateOptions): void {
  const url = routeToUrl(route)
  if (opts?.replace) {
    history.replaceState(null, '', url)
  } else {
    history.pushState(null, '', url)
  }
}
