export type AgentOpenTarget = {
  type: string
  path?: string
  id?: string
  date?: string
}

export type AgentOpenSource = 'open' | 'read_email'

/**
 * Navigate wiki / inbox / calendar when the agent uses `open` or when `read_email` mirrors email open on desktop.
 * When `isMobile` is true (viewport) **or** the UI is using slide-over detail (narrow chat workspace),
 * only the explicit `open` tool opens the detail panel; other tools stay as in-chat previews until the user opens them.
 */
export function navigateFromAgentOpen(
  target: AgentOpenTarget,
  ctx: {
    source: AgentOpenSource
    /** True when the shell uses slide-over / stacked detail (mobile viewport or narrow workspace column). */
    isMobile: boolean
    openWikiDoc: (path: string) => void
    /** Raw filesystem path — `/files/…` in the app, not wiki. */
    openFileDoc?: (path: string) => void
    openEmailFromSearch: (id: string, subject: string, from: string) => void
    switchToCalendar: (date: string, eventId?: string) => void
  },
): void {
  if (ctx.isMobile && ctx.source !== 'open') return
  if (target.type === 'file' && target.path) {
    ctx.openFileDoc?.(target.path)
    return
  }
  if (target.type === 'wiki' && target.path) {
    ctx.openWikiDoc(target.path)
    return
  }
  if (target.type === 'email' && target.id) {
    ctx.openEmailFromSearch(target.id, '', '')
    return
  }
  if (target.type === 'calendar' && target.date) {
    ctx.switchToCalendar(target.date)
  }
}
