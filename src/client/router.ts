/** Detail panel target (wiki, email thread, calendar, or raw file on disk). */
export type Overlay =
  | {
      type: 'wiki'
      path?: string
    }
  /** Indexed / readable file path (absolute); raw file viewer. */
  | { type: 'file'; path?: string }
  /** Google Drive or localDir document id (ripmail `read`); {@link IndexedFileViewer}. */
  | { type: 'indexed-file'; id?: string; source?: string }
  /** Visual artifact bytes resolved by `/api/files/artifact?ref=`; {@link VisualArtifactImageViewer}. */
  | { type: 'visual-artifact'; ref?: string; label?: string }
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
  /** Brain-to-brain access management list (`/settings/brain-access`). */
  | { type: 'brain-access' }
  /** Single policy detail (`/settings/brain-access/policy/:policyId`). */
  | { type: 'brain-access-policy'; policyId: string }
  /** Mail/calendar connections (`/settings/connections`). */
  | { type: 'settings-connections' }
  /** Wiki background activity (`/settings/wiki`). */
  | { type: 'settings-wiki' }
  | { type: 'hub-wiki-about' }
  | {
      type: 'wiki-dir'
      path?: string
    }
  | { type: 'chat-history' }

/** Primary surface of the current route. Absent (`undefined`) means the default chat column (`/c`). */
export type RouteZone = 'hub' | 'settings' | 'wiki' | 'inbox' | 'review'

/** Dedicated first-run path segment under `/onboarding/…` (matches persisted onboarding states). */
export type OnboardingUrlStep = 'not-started' | 'confirming-handle' | 'indexing'

const ONBOARDING_URL_STEPS: readonly OnboardingUrlStep[] = [
  'not-started',
  'confirming-handle',
  'indexing',
] as const

function isOnboardingUrlStep(seg: string): seg is OnboardingUrlStep {
  return (ONBOARDING_URL_STEPS as readonly string[]).includes(seg)
}

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
  flow?:
    | 'welcome'
    | 'hard-reset'
    | 'restart-seed'
    | 'first-chat'
    | 'enron-demo'
    /** Dev soft reset (`/reset`): client POST + replace to `/c`, or full-page GET handled by the server. */
    | 'dev-soft-reset'
  /**
   * When `flow` is `welcome`, URL is `/onboarding/{onboardingStep}`. Legacy `/welcome` parses as `not-started`.
   */
  onboardingStep?: OnboardingUrlStep
  /**
   * Primary surface when not the default chat column.
   * `'hub'` → `/hub`, `'settings'` → `/settings`, `'wiki'` → `/wiki/…`, `'inbox'` → `/inbox?…`, `'review'` → `/review/…`.
   * Absent means chat (`/c`).
   */
  zone?: RouteZone
  /** Inbound B2B session id when `zone === 'review'` (optional deep link). */
  reviewSessionId?: string
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
 * Wiki paths are relative to the markdown root (`wiki/`). Strip optional legacy `me/` from URLs/query.
 */
export function toUnifiedPersonalWikiPath(path: string | undefined): string | undefined {
  const p = path?.trim()
  if (!p) return undefined
  if (p === 'me') return ''
  if (p.startsWith('me/')) return p.slice('me/'.length)
  return p
}

/** Normalize `panel=wiki` / `panel=wiki-dir` path query segments. */
export function normalizeWikiOverlayQueryPath(path: string | undefined): string | undefined {
  return toUnifiedPersonalWikiPath(path)
}

function buildWikiPrimaryUrl(
  overlay: Extract<Overlay, { type: 'wiki' } | { type: 'wiki-dir' }>,
): string {
  if (overlay.type === 'wiki-dir') {
    const raw = overlay.path?.trim()
    if (!raw) return '/wiki/'
    const u = toUnifiedPersonalWikiPath(raw) ?? raw
    const trimmed = u.replace(/\/+$/g, '')
    if (!trimmed) return '/wiki/'
    return `/wiki/${encodeWikiPrimaryPathSegments(trimmed)}/`
  }
  const raw = overlay.path?.trim()
  /** Bare pathname `/wiki` is the wiki-dir hub; keep empty wiki reader addressable via `?panel=wiki`. */
  if (!raw) return '/wiki?panel=wiki'
  const u = toUnifiedPersonalWikiPath(raw) ?? raw
  return `/wiki/${encodeWikiPrimaryPathSegments(u)}`
}

/**
 * Path segments after `wiki` / `wikis` URL prefix (`['ideas','a.md']`, …), split on `/`.
 * Optional leading `me/` or `my-wiki/` is stripped (legacy URLs).
 */
function parseWikiPrimaryPathname(
  href: string,
  wikiRest: string[],
): { zone: 'wiki'; overlay: Overlay } {
  const url = new URL(href, 'http://localhost')
  const pathnameEndsWithSlash = url.pathname.endsWith('/')
  const decoded = wikiRest.map((s) => safeDecodePathSegment(s))

  let segments = decoded.filter(Boolean)
  if (segments[0] === 'me' || segments[0] === 'my-wiki') {
    segments = segments.slice(1)
  }

  const relPath = segments.join('/')
  const lastSeg = segments[segments.length - 1] ?? ''

  if (segments.length === 0) {
    return { zone: 'wiki', overlay: { type: 'wiki-dir' } }
  }

  const isFile = lastSeg.endsWith('.md') && !pathnameEndsWithSlash
  if (isFile) {
    return { zone: 'wiki', overlay: { type: 'wiki', path: relPath } }
  }

  const dirPath = relPath.replace(/\/+$/g, '') || undefined
  return { zone: 'wiki', overlay: { type: 'wiki-dir', path: dirPath } }
}

function overlayToSearchParams(overlay: Overlay): URLSearchParams {
  const q = new URLSearchParams()
  if (overlay.type === 'hub') {
    return q
  }
  q.set(PANEL, overlay.type)
  switch (overlay.type) {
    case 'wiki': {
      const normalized = normalizeWikiOverlayQueryPath(overlay.path)
      if (normalized) q.set('path', normalized)
      break
    }
    case 'wiki-dir': {
      const normalized = normalizeWikiOverlayQueryPath(overlay.path)
      if (normalized) q.set('path', normalized)
      break
    }
    case 'file':
      if (overlay.path) q.set('file', overlay.path)
      break
    case 'indexed-file':
      if (overlay.id) q.set('idx', overlay.id)
      if (overlay.source) q.set('src', overlay.source)
      break
    case 'visual-artifact':
      if (overlay.ref) q.set('ref', overlay.ref)
      if (overlay.label) q.set('label', overlay.label)
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
    case 'brain-access':
      break
    case 'brain-access-policy':
      if (overlay.policyId) q.set('brainPolicy', overlay.policyId)
      break
    case 'settings-connections':
    case 'settings-wiki':
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
      const path = normalizeWikiOverlayQueryPath(pathRaw)
      return path ? { type: 'wiki', path } : { type: 'wiki' }
    }
    case 'wiki-dir': {
      const pathRaw = sp.get('path')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw)
      return path ? { type: 'wiki-dir', path } : { type: 'wiki-dir' }
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
    case 'visual-artifact': {
      const ref = sp.get('ref')?.trim() || undefined
      const label = sp.get('label')?.trim() || undefined
      return {
        type: 'visual-artifact',
        ...(ref ? { ref } : {}),
        ...(label ? { label } : {}),
      }
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
    case 'brain-access':
      return { type: 'brain-access' }
    case 'brain-access-policy': {
      const brainPolicy = sp.get('brainPolicy')?.trim()
      return brainPolicy
        ? { type: 'brain-access-policy', policyId: brainPolicy }
        : { type: 'brain-access-policy', policyId: '' }
    }
    case 'settings-connections':
      return { type: 'settings-connections' }
    case 'settings-wiki':
      return { type: 'settings-wiki' }
    case 'hub-wiki-about':
      return { type: 'hub-wiki-about' }
    case 'hub':
      return { type: 'hub' }
    default:
      return undefined
  }
}

function inboxRouteFromSearch(href: string): Route | null {
  const url = new URL(href, 'http://localhost')
  if (url.pathname !== '/inbox') {
    return null
  }
  const overlay = overlayFromSearchParams(url.searchParams)
  if (!overlay) {
    return { zone: 'inbox' }
  }
  return { zone: 'inbox', overlay }
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

function reviewRouteFromPath(href: string): Route | null {
  const url = new URL(href, 'http://localhost')
  if (url.pathname !== '/review' && !url.pathname.startsWith('/review/')) {
    return null
  }
  const rest = url.pathname.slice('/review'.length)
  const rawSeg = rest.startsWith('/') ? rest.slice(1).split('/')[0]?.trim() ?? '' : ''
  if (!rawSeg) return { zone: 'review' }
  return { zone: 'review', reviewSessionId: safeDecodePathSegment(rawSeg) }
}

function settingsRouteFromSearch(href: string): Route | null {
  const url = new URL(href, 'http://localhost')
  if (!url.pathname.startsWith('/settings')) {
    return null
  }

  if (url.pathname === '/settings/brain-access') {
    return { zone: 'settings', overlay: { type: 'brain-access' } }
  }

  if (url.pathname === '/settings/connections') {
    return { zone: 'settings', overlay: { type: 'settings-connections' } }
  }

  if (url.pathname === '/settings/wiki') {
    return { zone: 'settings', overlay: { type: 'settings-wiki' } }
  }

  const previewRest = url.pathname.match(/^\/settings\/brain-access\/policy\/([^/]+)\/preview$/)
  if (previewRest?.[1]) {
    const policyId = safeDecodePathSegment(previewRest[1])
    return { zone: 'settings', overlay: { type: 'brain-access-policy', policyId } }
  }

  const policyRest = url.pathname.match(/^\/settings\/brain-access\/policy\/([^/]+)$/)
  if (policyRest?.[1]) {
    const policyId = safeDecodePathSegment(policyRest[1])
    return { zone: 'settings', overlay: { type: 'brain-access-policy', policyId } }
  }

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

  if (seg1 === 'welcome') {
    return { flow: 'welcome', onboardingStep: 'not-started' }
  }
  if (seg1 === 'onboarding') {
    const stepSeg = rest[0]?.trim() ?? ''
    if (stepSeg && isOnboardingUrlStep(stepSeg)) {
      return { flow: 'welcome', onboardingStep: stepSeg }
    }
    return { flow: 'welcome', onboardingStep: 'not-started' }
  }
  if (seg1 === 'reset') {
    return { flow: 'dev-soft-reset' }
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

  const inboxParsed = inboxRouteFromSearch(href)
  if (inboxParsed) {
    return inboxParsed
  }

  const hubParsed = hubRouteFromSearch(href)
  if (hubParsed) {
    return hubParsed
  }

  const settingsParsed = settingsRouteFromSearch(href)
  if (settingsParsed) {
    return settingsParsed
  }

  const reviewParsed = reviewRouteFromPath(href)
  if (reviewParsed) {
    return reviewParsed
  }

  if (seg1 === 'wiki' || seg1 === 'wikis') {
    const pathParts = url.pathname.split('/').filter(Boolean)
    const wikiRest = pathParts.slice(1)

    if (wikiRest.length > 0) {
      return parseWikiPrimaryPathname(href, wikiRest)
    }

    const sp = url.searchParams
    const panel = sp.get(PANEL)?.trim()
    if (panel === 'wiki-dir') {
      const pathRaw = sp.get('path')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw)
      return {
        zone: 'wiki',
        overlay: path ? { type: 'wiki-dir', path } : { type: 'wiki-dir' },
      }
    }
    if (panel === 'wiki') {
      const pathRaw = sp.get('path')?.trim() || undefined
      const path = normalizeWikiOverlayQueryPath(pathRaw)
      return {
        zone: 'wiki',
        overlay: path ? { type: 'wiki', path } : { type: 'wiki' },
      }
    }
    const pathOnlyRaw = sp.get('path')?.trim()
    const pathOnly = normalizeWikiOverlayQueryPath(pathOnlyRaw)
    if (pathOnly) {
      return {
        zone: 'wiki',
        overlay: {
          type: 'wiki',
          path: pathOnly,
        },
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
  if (route.flow === 'welcome') {
    const step = route.onboardingStep ?? 'not-started'
    return `/onboarding/${step}`
  }
  if (route.flow === 'dev-soft-reset') return '/reset'
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
      return buildWikiPrimaryUrl(o)
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/wiki?${qs}` : '/wiki'
  }

  if (zone === 'inbox') {
    if (!o) {
      return '/inbox'
    }
    const q = overlayToSearchParams(o)
    const qs = q.toString()
    return qs ? `/inbox?${qs}` : '/inbox'
  }

  if (zone === 'review') {
    const sid = route.reviewSessionId?.trim()
    return sid ? `/review/${encodeURIComponent(sid)}` : '/review'
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
    if (o?.type === 'brain-access') {
      return '/settings/brain-access'
    }
    if (o?.type === 'settings-connections') {
      return '/settings/connections'
    }
    if (o?.type === 'settings-wiki') {
      return '/settings/wiki'
    }
    if (o?.type === 'brain-access-policy') {
      const id = o.policyId?.trim()
      if (id) {
        return `/settings/brain-access/policy/${encodeURIComponent(id)}`
      }
      return '/settings/brain-access'
    }
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
