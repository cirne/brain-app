export type AgentOpenTarget = {
  type: string
  path?: string
  id?: string
  date?: string
}

export type AgentOpenSource = 'open' | 'read_doc'

/**
 * Navigate wiki / inbox / calendar when the agent uses `open` or when `read_doc` mirrors email open on desktop.
 * On mobile, only the explicit `open` tool opens the detail panel; other tools stay as in-chat previews until the user taps through.
 */
export function navigateFromAgentOpen(
  target: AgentOpenTarget,
  ctx: {
    source: AgentOpenSource
    isMobile: boolean
    openWikiDoc: (path: string) => void
    openEmailFromSearch: (id: string, subject: string, from: string) => void
    switchToCalendar: (date: string, eventId?: string) => void
  },
): void {
  if (ctx.isMobile && ctx.source !== 'open') return
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
