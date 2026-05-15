/**
 * Inline extracted text for indexed-file viewer context into chat system prompt
 * (parity with legacy wiki `context.files` grounding in POST /api/chat).
 */
import { ripmailResolveEntryJson } from '@server/ripmail/index.js'

/** Max indexed bodies appended per chat turn (ignore extras). */
export const INDEXED_OPEN_FILES_BODY_MAX = 3

/** Per-document cap — large spreadsheets/mail exports stay bounded. */
export const INDEXED_OPEN_FILE_CONTEXT_MAX_CHARS = 120_000

function fenceLangForMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('csv') || m.includes('comma-separated')) return 'csv'
  if (m.includes('tab-separated') || m.includes('tsv')) return 'tsv'
  if (m.includes('markdown')) return 'markdown'
  if (m.includes('html')) return 'html'
  if (m.includes('json')) return 'json'
  return 'text'
}

export async function mergeIndexedOpenFilesIntoChatContext(
  base: string | undefined,
  entries: ReadonlyArray<{ id: string; source?: string }>,
  ripmailHome: string,
): Promise<string | undefined> {
  const trimmed = entries
    .map((e) => ({
      id: e.id.trim(),
      source: e.source?.trim() || undefined,
    }))
    .filter((e) => e.id.length > 0)
    .slice(0, INDEXED_OPEN_FILES_BODY_MAX)

  if (!trimmed.length) return base

  const sections: string[] = []
  for (const ent of trimmed) {
    try {
      const payload = await ripmailResolveEntryJson(
        ripmailHome,
        ent.id,
        ent.source ? { sourceId: ent.source } : undefined,
      )
      if (!payload || payload.entryKind !== 'indexed-file') continue

      const title = payload.title.trim() || ent.id
      const lang = fenceLangForMime(payload.mime)
      let text = payload.body ?? ''
      let truncated = false
      if (text.length > INDEXED_OPEN_FILE_CONTEXT_MAX_CHARS) {
        text = text.slice(0, INDEXED_OPEN_FILE_CONTEXT_MAX_CHARS)
        truncated = true
      }
      const truncNote = truncated
        ? '\n\n… (truncated for chat context — call read_indexed_file for the full export when needed)\n'
        : ''

      sections.push(
        `### ${title}\nIndexed id: \`${payload.id}\` · ${payload.sourceKind} · ${payload.mime}` +
          (ent.source ? ` · ripmail source: \`${ent.source}\`` : '') +
          `\n\n\`\`\`${lang}\n${text}${truncated ? '\n' : ''}\`\`\`${truncNote}`,
      )
    } catch {
      /* Missing ripmail DB / resolver errors — keep surface pointer only */
    }
  }

  if (!sections.length) return base

  const injected = ['## Open indexed document(s) — extracted text for this session', ...sections].join('\n\n')
  const b = base?.trim()
  return b ? `${b}\n\n${injected}` : injected
}
