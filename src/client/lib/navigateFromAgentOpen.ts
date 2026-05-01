export type AgentOpenTarget = {
  type: string
  path?: string
  id?: string
  date?: string
  /** Ripmail source id (`read_indexed_file` args.source) for indexed-file opens */
  source?: string
}

export type AgentOpenSource = 'open' | 'read_mail_message' | 'read_indexed_file'

/**
 * Navigate wiki / inbox / calendar when the agent uses `open` or when **`read_mail_message`** / **`read_indexed_file`** mirrors email/file open on desktop.
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
    /** Drive / localDir indexed document id (not email thread). */
    openIndexedFileDoc?: (id: string, source?: string) => void
    openEmailFromSearch: (id: string, subject: string, from: string) => void
    switchToCalendar: (date: string, eventId?: string) => void
  },
): void {
  if (ctx.isMobile && ctx.source !== 'open') return
  if (target.type === 'file' && target.path) {
    ctx.openFileDoc?.(target.path)
    return
  }
  if (target.type === 'indexed-file' && target.id) {
    ctx.openIndexedFileDoc?.(target.id, target.source)
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
