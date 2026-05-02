export type AgentOpenTarget = {
  type: string
  path?: string
  /**
   * Rare legacy: path without `@handle/` — combine into `@handle/path` so the shell uses one
   * unified path in the overlay (same as `wikis/` layout).
   */
  shareHandle?: string
  id?: string
  date?: string
  /** Ripmail source id (`read_indexed_file` args.source) for indexed-file opens */
  source?: string
}

export type AgentOpenSource = 'open' | 'read_mail_message' | 'read_indexed_file'

/**
 * Navigate wiki / inbox / calendar when the agent uses **`open`** (streamed `tool_start`, when routed here).
 * **`read_mail_message`** / **`read_indexed_file`** do not call this from the SSE stream — preview in chat; user or **`open`** opens the panel.
 * When `isMobile` is true (viewport) **or** the UI uses slide-over detail (narrow workspace), **`open`** alone opens the detail panel from the stream.
 */
export function navigateFromAgentOpen(
  target: AgentOpenTarget,
  ctx: {
    source: AgentOpenSource
    /** True when the shell uses slide-over / stacked detail (mobile viewport or narrow workspace column). */
    isMobile: boolean
    /** Unified wiki path: `@theirHandle/…`, `me/…`, or vault-relative under my wiki. */
    openWikiDoc: (unifiedPath: string) => void
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
    const raw = target.path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
    const shLegacy =
      typeof (target as { shareHandle?: unknown }).shareHandle === 'string'
        ? String((target as { shareHandle: string }).shareHandle).trim().replace(/^@+/, '').trim()
        : ''
    const unified =
      raw.startsWith('@') || !shLegacy.length
        ? raw
        : `@${shLegacy}/${raw.replace(/^\/+/, '')}`
    ctx.openWikiDoc(unified)
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
