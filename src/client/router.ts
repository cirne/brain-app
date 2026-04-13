export type Route =
  | { tab: 'today' }
  | { tab: 'inbox'; id?: string }
  | { tab: 'wiki'; path?: string }
  | { tab: 'calendar'; date?: string }

export type SurfaceContext =
  | { type: 'today'; date: string }
  | { type: 'email'; threadId: string; subject: string; from: string; body?: string }
  | { type: 'wiki'; path: string; title: string }
  | { type: 'calendar'; date: string; eventId?: string }
  | { type: 'none' }

/** Serialize a SurfaceContext to a human-readable string for the agent. */
export function contextToString(ctx: SurfaceContext): string | undefined {
  if (ctx.type === 'email') {
    let s = `The user is currently viewing this email (id: ${ctx.threadId}): "${ctx.subject}" from ${ctx.from}.`
    if (ctx.body) s += `\n\nEmail content:\n${ctx.body}`
    else s += ` Use read_email with this id to access the email content.`
    return s
  }
  if (ctx.type === 'wiki') return `The user is viewing wiki doc: ${ctx.path} (title: "${ctx.title}")`
  if (ctx.type === 'calendar') return `The user is viewing their calendar for ${ctx.date}`
  if (ctx.type === 'today') return `The user is on the Today view. Today is ${ctx.date}`
  return undefined
}

/** Parse a URL (defaults to current location) into a Route. */
export function parseRoute(href: string = location.href): Route {
  const url = new URL(href, 'http://localhost')
  const [, seg1, ...rest] = url.pathname.split('/')

  // Legacy: /chat and /home redirect to today
  if (seg1 === 'chat' || seg1 === 'home') {
    return { tab: 'today' }
  }
  if (seg1 === 'wiki') {
    if (rest.length > 0 && rest[0]) {
      return { tab: 'wiki', path: rest.map(decodeURIComponent).join('/') }
    }
    return { tab: 'wiki' }
  }
  if (seg1 === 'inbox') {
    const id = rest[0] ? decodeURIComponent(rest[0]) : undefined
    return { tab: 'inbox', id }
  }
  if (seg1 === 'calendar') {
    const date = url.searchParams.get('date') ?? undefined
    return { tab: 'calendar', date }
  }

  // Default: today
  return { tab: 'today' }
}

/** Convert a Route back to a URL string. */
export function routeToUrl(route: Route): string {
  if (route.tab === 'today') return '/'
  if (route.tab === 'inbox') {
    return route.id ? `/inbox/${encodeURIComponent(route.id)}` : '/inbox'
  }
  if (route.tab === 'calendar') {
    return route.date ? `/calendar?date=${route.date}` : '/calendar'
  }
  // wiki
  return route.path
    ? `/wiki/${route.path.split('/').map(encodeURIComponent).join('/')}`
    : '/wiki'
}

/** Push a new route onto the browser history stack. */
export function navigate(route: Route): void {
  history.pushState(null, '', routeToUrl(route))
}
