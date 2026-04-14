/** Detail panel target (wiki, email thread, or calendar). */
export type Overlay =
  | { type: 'wiki'; path?: string }
  | { type: 'email'; id?: string }
  | { type: 'calendar'; date?: string }

/** Chat-first shell: optional detail overlay; base route is always chat. */
export type Route = {
  overlay?: Overlay
}

export type SurfaceContext =
  | { type: 'chat' }
  | { type: 'email'; threadId: string; subject: string; from: string; body?: string }
  | { type: 'wiki'; path: string; title: string }
  | { type: 'calendar'; date: string; eventId?: string }
  | { type: 'inbox' }
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
  if (ctx.type === 'calendar') return `The user is viewing their calendar for ${ctx.date}`
  if (ctx.type === 'inbox') {
    return 'The user asked for a summary of the triaged inbox items in their message. Use the ripmail tool (e.g. read <id> --json, or search with --json) with the message ids provided as needed, then answer concisely.'
  }
  return undefined
}

/** Parse a URL (defaults to current location) into a Route. */
export function parseRoute(href: string = location.href): Route {
  const url = new URL(href, 'http://localhost')
  const [, seg1, ...rest] = url.pathname.split('/')

  // Legacy: /chat and /home → chat only
  if (seg1 === 'chat' || seg1 === 'home') {
    return {}
  }
  if (seg1 === 'wiki') {
    if (rest.length > 0 && rest[0]) {
      return { overlay: { type: 'wiki', path: rest.map(decodeURIComponent).join('/') } }
    }
    return { overlay: { type: 'wiki' } }
  }
  if (seg1 === 'inbox') {
    const id = rest[0] ? decodeURIComponent(rest[0]) : undefined
    return { overlay: id ? { type: 'email', id } : { type: 'email' } }
  }
  if (seg1 === 'calendar') {
    const date = url.searchParams.get('date') ?? undefined
    return { overlay: date ? { type: 'calendar', date } : { type: 'calendar' } }
  }

  // Default: chat only
  return {}
}

/** Convert a Route back to a URL string. */
export function routeToUrl(route: Route): string {
  const o = route.overlay
  if (!o) return '/'
  if (o.type === 'wiki') {
    return o.path
      ? `/wiki/${o.path.split('/').map(encodeURIComponent).join('/')}`
      : '/wiki'
  }
  if (o.type === 'email') {
    return o.id ? `/inbox/${encodeURIComponent(o.id)}` : '/inbox'
  }
  if (o.type === 'calendar') {
    return o.date ? `/calendar?date=${encodeURIComponent(o.date)}` : '/calendar'
  }
  return '/'
}

/** Push a new route onto the browser history stack. */
export function navigate(route: Route): void {
  history.pushState(null, '', routeToUrl(route))
}
