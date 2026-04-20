/**
 * Compact tool-arg summaries for collapsed rows (hub activity, chat) and onboarding seeding paths.
 * Prefer rich {@link matchContentPreview} cards when present so paths match wiki/file previews.
 */
import type { ToolCall } from '../agentUtils.js'
import type { ContentCardPreview } from '../cards/contentCardShared.js'
import { wikiPathForReadToolArg } from '../cards/contentCardShared.js'
import { matchContentPreview } from './matchPreview.js'

export type ToolSummaryParts =
  | { mode: 'single_path'; path: string }
  | { mode: 'move'; from: string; to: string }
  | { mode: 'text'; text: string }

const MAX_PATTERN = 72
const MAX_SCOPE = 40

function truncateEnd(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, Math.max(0, max - 1))}…`
}

/** Normalized `args.path` for wiki write/edit/etc. — shared with onboarding seeding rows. */
export function wikiToolPathForSeeding(args: Record<string, unknown>): string | undefined {
  const raw = typeof args.path === 'string' ? args.path.trim() : ''
  return raw.length ? wikiPathForReadToolArg(raw) : undefined
}

/** Secondary line from raw args when no preview card applies (grep/find/move, or fallback). */
export function toolSummaryPartsFromArgs(name: string, args: unknown): ToolSummaryParts | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>

  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
    case 'delete_file': {
      const raw = typeof a.path === 'string' ? a.path.trim() : ''
      return raw.length ? { mode: 'single_path', path: wikiPathForReadToolArg(raw) } : null
    }
    case 'move_file': {
      if (typeof a.from !== 'string' || typeof a.to !== 'string') return null
      const from = a.from.trim()
      const to = a.to.trim()
      if (!from.length || !to.length) return null
      return {
        mode: 'move',
        from: wikiPathForReadToolArg(from),
        to: wikiPathForReadToolArg(to),
      }
    }
    case 'grep': {
      if (typeof a.pattern !== 'string') return null
      const pattern = a.pattern.trim()
      if (!pattern.length) return null
      const scopeRaw =
        typeof a.path === 'string' && a.path.trim()
          ? a.path.trim()
          : typeof a.glob === 'string' && a.glob.trim()
            ? a.glob.trim()
            : ''
      const pat = truncateEnd(pattern, MAX_PATTERN)
      if (!scopeRaw) return { mode: 'text', text: pat }
      return { mode: 'text', text: `${pat} · ${truncateEnd(scopeRaw, MAX_SCOPE)}` }
    }
    case 'find': {
      if (typeof a.pattern !== 'string') return null
      const pattern = a.pattern.trim()
      if (!pattern.length) return null
      const pat = truncateEnd(pattern, MAX_PATTERN)
      if (typeof a.path === 'string' && a.path.trim()) {
        return { mode: 'text', text: `${pat} · ${truncateEnd(a.path.trim(), MAX_SCOPE)}` }
      }
      return { mode: 'text', text: pat }
    }
    default:
      return null
  }
}

/**
 * Collapsed summary line for a tool call — uses the same preview card as {@link ContentPreviewCards}
 * when available so titles match wiki strips / diff cards.
 */
export function toolCallCollapsedSummaryParts(
  tc: ToolCall,
  preview: ContentCardPreview | null,
): ToolSummaryParts | null {
  if (tc.done && !tc.isError && preview != null) {
    if (preview.kind === 'wiki' || preview.kind === 'wiki_edit_diff') {
      return { mode: 'single_path', path: preview.path }
    }
    if (preview.kind === 'file') {
      return { mode: 'single_path', path: preview.path }
    }
  }
  return toolSummaryPartsFromArgs(tc.name, tc.args)
}

/** @see toolCallCollapsedSummaryParts — computes preview internally (tests, call sites without preview). */
export function toolCallSummaryPartsFromTool(tc: ToolCall): ToolSummaryParts | null {
  const preview = matchContentPreview(tc)
  return toolCallCollapsedSummaryParts(tc, preview)
}

/** Wiki path for “open in wiki” affordance — normalizes like read-tool previews. */
export function wikiOpenPathFromArgs(name: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>
  if (name === 'move_file' && typeof a.to === 'string') {
    const p = a.to.trim()
    return p.length ? wikiPathForReadToolArg(p) : null
  }
  if ((name === 'read' || name === 'write' || name === 'edit' || name === 'delete_file') && typeof a.path === 'string') {
    const p = a.path.trim()
    return p.length ? wikiPathForReadToolArg(p) : null
  }
  return null
}

/**
 * In-flight verb for path-based wiki file tools — prefixes align with {@link buildSeedingLine} (write/edit).
 */
export function wikiFilePendingVerb(name: string): string | null {
  switch (name) {
    case 'write':
      return 'Writing'
    case 'edit':
      return 'Updating'
    case 'read':
      return 'Reading'
    case 'delete_file':
      return 'Deleting'
    case 'move_file':
      return 'Moving'
    default:
      return null
  }
}
