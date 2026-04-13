export type Route =
  | { tab: 'chat'; file?: string; message?: string }
  | { tab: 'inbox'; id?: string }
  | { tab: 'calendar'; date?: string }

/** Parse a URL (defaults to current location) into a Route. */
export function parseRoute(href: string = location.href): Route {
  const url = new URL(href, 'http://localhost')
  const [, seg1, ...rest] = url.pathname.split('/')

  // Legacy wiki routes → chat
  if (seg1 === 'wiki') {
    return { tab: 'chat' }
  }
  if (seg1 === 'inbox') {
    const id = rest[0] ? decodeURIComponent(rest[0]) : undefined
    return { tab: 'inbox', id }
  }
  if (seg1 === 'calendar') {
    const date = url.searchParams.get('date') ?? undefined
    return { tab: 'calendar', date }
  }

  // Default: chat
  const file = url.searchParams.get('file') ?? undefined
  return { tab: 'chat', file }
}

/** Convert a Route back to a URL string. */
export function routeToUrl(route: Route): string {
  if (route.tab === 'inbox') {
    return route.id ? `/inbox/${encodeURIComponent(route.id)}` : '/inbox'
  }
  if (route.tab === 'calendar') {
    return route.date ? `/calendar?date=${route.date}` : '/calendar'
  }
  // chat
  return route.file ? `/chat?file=${encodeURIComponent(route.file)}` : '/chat'
}

/** Push a new route onto the browser history stack. */
export function navigate(route: Route): void {
  history.pushState(null, '', routeToUrl(route))
}
