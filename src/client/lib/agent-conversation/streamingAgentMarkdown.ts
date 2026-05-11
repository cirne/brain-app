import { renderMarkdown } from '../markdown.js'
import { wikiPathForReadToolArg } from '../cards/contentCards.js'
import { stripTrailingSuggestReplyChoicesJson } from '../tools/suggestReplyChoices.js'

/** Upper bound for very large streamed payloads (e.g. me.md preview). */
export const STREAMING_AGENT_MD_MAX = 50_000

const PRE_BLOCK_RE = /<pre\b[\s\S]*?<\/pre>/gi
const DATA_WIKI_ANCHOR_RE = /<a\s+([^>]*)>([\s\S]*?)<\/a>/gi
const INLINE_CODE_RE = /<code>([^<]+)<\/code>/gi

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function attrValue(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return m ? decodeHtmlText(m[2]) : null
}

function assistantWikiChipPlaceholder(path: string, title: string): string {
  const safePath = escapeHtmlAttribute(path)
  const safeTitle = escapeHtmlAttribute(title)
  return `<a href="#" data-wiki="${safePath}" data-brain-wiki-chip class="assistant-wiki-ref user-mention user-mention--wiki inline-flex max-w-full items-baseline align-baseline rounded-sm bg-accent-dim px-1 py-0 text-[0.9em] text-accent no-underline" title="${safeTitle}"></a>`
}

function normalizeInlineWikiReference(raw: string): string | null {
  const trimmed = decodeHtmlText(raw).trim()
  if (!trimmed) return null
  const withoutMention = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  const withoutLeadingSlash = withoutMention.replace(/^\/+/, '')
  if (!/\.(?:md|mdx)$/i.test(withoutLeadingSlash)) return null
  if (!trimmed.startsWith('@') && !withoutLeadingSlash.includes('/')) return null
  if (withoutLeadingSlash.includes('://')) return null
  return wikiPathForReadToolArg(withoutLeadingSlash)
}

/**
 * Assistant prose has a stricter contract than general wiki markdown:
 * models should emit `[Title](wiki-root/path.md)`. We upgrade those known
 * `data-wiki` links into mount points for `WikiFileName`, while retaining a
 * narrow inline-code fallback for older transcripts that used `` `@path.md` ``.
 */
export function assistantWikiReferenceHtml(html: string): string {
  const protectedPreBlocks: string[] = []
  let out = html.replace(PRE_BLOCK_RE, (block) => {
    const token = `__BRAIN_PRE_BLOCK_${protectedPreBlocks.length}__`
    protectedPreBlocks.push(block)
    return token
  })

  out = out.replace(DATA_WIKI_ANCHOR_RE, (full, attrs: string, inner: string) => {
    if (/\bdata-brain-wiki-chip\b/i.test(attrs)) return full
    const wikiPath = attrValue(attrs, 'data-wiki')
    if (!wikiPath) return full
    const title = attrValue(attrs, 'title') ?? inner.replace(/<[^>]*>/g, '').trim() ?? wikiPath
    return assistantWikiChipPlaceholder(wikiPath, title || wikiPath)
  })

  out = out.replace(INLINE_CODE_RE, (full, codeText: string) => {
    const wikiPath = normalizeInlineWikiReference(codeText)
    if (!wikiPath) return full
    return assistantWikiChipPlaceholder(wikiPath, decodeHtmlText(codeText).trim())
  })

  return protectedPreBlocks.reduce(
    (restored, block, index) => restored.replace(`__BRAIN_PRE_BLOCK_${index}__`, block),
    out,
  )
}

/**
 * Markdown → HTML for in-flight assistant text (chat, onboarding). Caps optional length before parse.
 */
export function streamingAgentMessageHtml(content: string, maxLength?: number): string {
  const cleaned = stripTrailingSuggestReplyChoicesJson(content)
  const capped =
    maxLength !== undefined && cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned
  return assistantWikiReferenceHtml(renderMarkdown(capped))
}
