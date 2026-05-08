/**
 * Token-stream parser for the chat composer's plain-text mention grammar.
 *
 * Persisted user messages are still plain text; this helper only powers
 * transcript rendering so people mentions show up as person chips and wiki
 * mentions keep their document-style treatment. The grammar mirrors what
 * {@link extractMentionedFiles} already understands so chat plumbing keeps
 * working without schema changes:
 *
 *  - Vault wiki:    `@me/<path>.md`
 *  - Shared wiki:   `@<handle>/<path>.md`
 *  - Person:        `@<handle>` (no slash, no `.md`)
 *
 * Anything else (e.g. an `@` followed by punctuation) stays as plain text.
 */

/** Plain text run between mentions. */
export type UserMessageTextSegment = { kind: 'text'; text: string }

/** Wiki document mention — surfaces with the existing document chip style. */
export type UserMessageWikiSegment = {
  kind: 'wiki'
  /** Vault-relative path (`me/...md` or `handle/...md`). */
  path: string
  /** Token literal as it appears in `msg.content` (`@me/x.md`). */
  raw: string
}

/** Person mention — surfaces with a dedicated person chip. */
export type UserMessagePersonSegment = {
  kind: 'person'
  /** Lowercased workspace handle without the leading `@`. */
  handle: string
  /** Token literal as it appears in `msg.content` (`@alex`). */
  raw: string
}

export type UserMessageSegment =
  | UserMessageTextSegment
  | UserMessageWikiSegment
  | UserMessagePersonSegment

/**
 * Workspace handles per `parseWorkspaceHandle`: 3–32 chars, lowercase
 * alphanumeric, hyphens allowed inside (not at start/end). The renderer is
 * intentionally permissive on case so we still chip handles a user typed in
 * mixed case; downstream code lowercases when needed.
 */
const HANDLE_BODY = '[A-Za-z0-9](?:[A-Za-z0-9-]{1,30}[A-Za-z0-9])'

/**
 * Combined mention regex: prefer the more specific wiki form first so a
 * mention like `@alex/notes/idea.md` is captured as a document rather than
 * splitting at `@alex`. The `me/` and handle/ branches keep separate capture
 * groups so callers can normalize without re-parsing.
 */
const MENTION_RE = new RegExp(
  [
    // Vault wiki
    '@(me\\/[\\w./-]+\\.md)\\b',
    // Shared wiki
    `@(${HANDLE_BODY}\\/[\\w./-]+\\.md)\\b`,
    // Person handle (no slash, no `.md`)
    `@(${HANDLE_BODY})(?![\\w./-]*\\.md\\b)(?![A-Za-z0-9-])`,
  ].join('|'),
  'g',
)

/** True when `tok` looks like a workspace handle (length + character set). */
function looksLikeHandleToken(tok: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/i.test(tok)
}

/**
 * Parse `text` into an ordered list of plain-text and mention segments. The
 * caller renders each segment in place, so this preserves whitespace and
 * untouched characters between tokens.
 */
export function parseUserMessageSegments(text: string): UserMessageSegment[] {
  if (!text) return []
  const out: UserMessageSegment[] = []
  let cursor = 0

  MENTION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_RE.exec(text)) !== null) {
    const matchStart = m.index
    const matchEnd = matchStart + m[0].length

    // Mention must start at the beginning of the message or after whitespace
    // / punctuation. We re-check here because the regex doesn't anchor on
    // word boundaries (handles can start with letters too).
    const prevChar = matchStart === 0 ? '' : text[matchStart - 1]
    if (prevChar && /[A-Za-z0-9_]/.test(prevChar)) {
      MENTION_RE.lastIndex = matchStart + 1
      continue
    }

    if (matchStart > cursor) {
      out.push({ kind: 'text', text: text.slice(cursor, matchStart) })
    }

    const meWiki = m[1]
    const handleWiki = m[2]
    const personHandle = m[3]
    if (typeof meWiki === 'string' && meWiki.length > 0) {
      out.push({ kind: 'wiki', path: meWiki, raw: m[0] })
    } else if (typeof handleWiki === 'string' && handleWiki.length > 0) {
      out.push({ kind: 'wiki', path: handleWiki, raw: m[0] })
    } else if (typeof personHandle === 'string' && looksLikeHandleToken(personHandle)) {
      out.push({ kind: 'person', handle: personHandle.toLowerCase(), raw: m[0] })
    } else {
      out.push({ kind: 'text', text: m[0] })
    }
    cursor = matchEnd
  }

  if (cursor < text.length) {
    out.push({ kind: 'text', text: text.slice(cursor) })
  }
  return out
}
