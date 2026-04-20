import {
  absolutePathFromUrlSegments,
  encodeFilesystemPathForUrl,
  isFilesystemAbsolutePath,
  wikiUrlSegmentsLookLikeFilesystemPath,
} from './lib/fsPath.js'
import { encodeWikiPathSegmentsForUrl } from './lib/wikiPageHtml.js'

/** Detail panel target (wiki, email thread, calendar, or raw file on disk). */
export type Overlay =
  | { type: 'wiki'; path?: string }
  /** Indexed / readable file path (absolute); shown under `/files/…`, not wiki. */
  | { type: 'file'; path?: string }
  | { type: 'email'; id?: string }
  | { type: 'calendar'; date?: string; eventId?: string }
  /** `chat` is canonical chat_identifier (E.164, email, …) for /api/messages/thread */
  | { type: 'messages'; chat?: string }
  /** Your Wiki supervisor inspector (`/your-wiki`). */
  | { type: 'your-wiki' }
  /** Brain Hub: inspect/remove a search index source (`/hub-source?id=`). */
  | { type: 'hub-source'; id?: string }
  /** Brain Hub: guided assistant to add local folders to the search index (`/hub-add-folders`). */
  | { type: 'hub-add-folders' }
  /** Brain Hub admin/settings/status page (`/hub`). */
  | { type: 'hub' }
  /** Brain Hub: help copy explaining the private wiki (`/hub/wiki-about`). */
  | { type: 'hub-wiki-about' }
  /** Phone access QR code panel. */
  | { type: 'phone-access' }

/** Chat-first shell: optional detail overlay; base route is always chat. */
export type Route = {
  overlay?: Overlay
  /** Full-page flows (onboarding wizard, dev hard-reset / restart-seed / first-chat). */
  flow?: 'onboarding' | 'hard-reset' | 'restart-seed' | 'first-chat'
  /** When true, the Brain Hub is rendered in the main content area instead of chat. */
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
  if (ctx.type === 'file') {
    return `The user is viewing a raw file on disk: ${ctx.path} (title: "${ctx.title}"). Use read_doc with this path if you need the extracted text.`
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

function safeDecodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** Parse a URL (defaults to current location) into a Route. */
export function parseRoute(href: string = location.href): Route {
  const url = new URL(href, 'http://localhost')
  const [, seg1, ...rest] = url.pathname.split('/')

  if (seg1 === 'onboarding') {
    return { flow: 'onboarding' }
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

  // Legacy: /chat and /home → chat only
  if (seg1 === 'chat' || seg1 === 'home') {
    return {}
  }
  if (seg1 === 'files') {
    const path = absolutePathFromUrlSegments(rest)
    if (path) {
      return { overlay: { type: 'file', path } }
    }
    return { overlay: { type: 'file' } }
  }
  if (seg1 === 'wiki') {
    // Legacy: `/wiki/Users/...` or `/wiki//Users/...` pointed at disk — treat as raw file, not wiki markdown.
    if (wikiUrlSegmentsLookLikeFilesystemPath(rest)) {
      const fsPath = absolutePathFromUrlSegments(rest)
      if (fsPath && isFilesystemAbsolutePath(fsPath)) {
        return { overlay: { type: 'file', path: fsPath } }
      }
    }
    if (rest.length > 0 && rest[0]) {
      return { overlay: { type: 'wiki', path: rest.map(decodeURIComponent).join('/') } }
    }
    return { overlay: { type: 'wiki' } }
  }
  if (seg1 === 'inbox') {
    /** Prefer query param so opaque ids (e.g. with `@`, `+`) are not split or mishandled in the path. */
    const qId = url.searchParams.get('m') ?? url.searchParams.get('id')
    if (qId) {
      return { overlay: { type: 'email', id: qId } }
    }
    if (rest.length > 0 && rest[0]) {
      const id = rest.map(safeDecodePathSegment).join('/')
      return { overlay: { type: 'email', id } }
    }
    return { overlay: { type: 'email' } }
  }
  if (seg1 === 'calendar') {
    const date = url.searchParams.get('date') ?? undefined
    const eventId = url.searchParams.get('event') ?? undefined
    if (!date) {
      return { overlay: { type: 'calendar' } }
    }
    return { overlay: { type: 'calendar', date, ...(eventId ? { eventId } : {}) } }
  }
  if (seg1 === 'messages') {
    const c = url.searchParams.get('c') ?? undefined
    if (c) return { overlay: { type: 'messages', chat: c } }
    return { overlay: { type: 'messages' } }
  }
  if (seg1 === 'your-wiki' || seg1 === 'background-agent') {
    return { overlay: { type: 'your-wiki' } }
  }
  if (seg1 === 'hub-source') {
    const id = url.searchParams.get('id') ?? undefined
    return { overlay: { type: 'hub-source', ...(id ? { id } : {}) } }
  }
  if (seg1 === 'hub-add-folders') {
    return { overlay: { type: 'hub-add-folders' } }
  }
  if (seg1 === 'phone-access') {
    return { overlay: { type: 'phone-access' } }
  }
  if (seg1 === 'wiki-about') {
    return { overlay: { type: 'hub-wiki-about' } }
  }
  if (seg1 === 'hub') {
    if (rest.length > 0) {
      if (rest[0] === 'phone-access') {
        return { overlay: { type: 'phone-access' }, hubActive: true }
      }
      if (rest[0] === 'wiki-about') {
        return { overlay: { type: 'hub-wiki-about' }, hubActive: true }
      }
      const subRoute = parseRoute(`http://localhost/${rest.join('/')}${url.search}`)
      return { ...subRoute, hubActive: true }
    }
    return { overlay: { type: 'hub' } }
  }

  // Default: chat only
  return {}
}

/** Convert a Route back to a URL string. */
export function routeToUrl(route: Route): string {
  if (route.flow === 'onboarding') return '/onboarding'
  if (route.flow === 'hard-reset') return '/hard-reset'
  if (route.flow === 'restart-seed') return '/restart-seed'
  if (route.flow === 'first-chat') return '/first-chat'
  const o = route.overlay
  if (!o) return route.hubActive ? '/hub' : '/'
  
  let path = ''
  if (o.type === 'wiki') {
    path = o.path ? `/wiki/${encodeWikiPathSegmentsForUrl(o.path)}` : '/wiki'
  } else if (o.type === 'file') {
    path = o.path ? `/files/${encodeFilesystemPathForUrl(o.path)}` : '/files'
  } else if (o.type === 'email') {
    if (!o.id) path = '/inbox'
    else {
      const q = new URLSearchParams()
      q.set('m', o.id)
      path = `/inbox?${q.toString()}`
    }
  } else if (o.type === 'calendar') {
    if (!o.date) path = '/calendar'
    else {
      const q = new URLSearchParams()
      q.set('date', o.date)
      if (o.eventId) q.set('event', o.eventId)
      path = `/calendar?${q.toString()}`
    }
  } else if (o.type === 'messages') {
    if (!o.chat) path = '/messages'
    else {
      const q = new URLSearchParams()
      q.set('c', o.chat)
      path = `/messages?${q.toString()}`
    }
  } else if (o.type === 'your-wiki') {
    path = '/your-wiki'
  } else if (o.type === 'hub-source') {
    if (!o.id) path = '/hub-source'
    else {
      const q = new URLSearchParams()
      q.set('id', o.id)
      path = `/hub-source?${q.toString()}`
    }
  } else if (o.type === 'hub-add-folders') {
    path = '/hub-add-folders'
  } else if (o.type === 'hub') {
    return '/hub'
  } else if (o.type === 'hub-wiki-about') {
    return route.hubActive ? '/hub/wiki-about' : '/wiki-about'
  } else if (o.type === 'phone-access') {
    return route.hubActive ? '/hub/phone-access' : '/phone-access'
  }

  if (route.hubActive && path) {
    return `/hub${path}`
  }
  return path || '/'
}

export type NavigateOptions = {
  /**
   * Use `history.replaceState` instead of `pushState`. Prefer when leaving an
   * overlay for chat-only so ⌫/⌥← does not immediately restore the closed panel
   * (same URL stack entry is updated instead of pushing a second `/` on top of `/wiki/…`).
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
