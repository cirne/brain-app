/**
 * search() — regex pattern + SQL filters + date-recency ranking.
 * Mirrors ripmail/src/search/engine.rs search_with_meta.
 *
 * Key design note: ripmail uses JS/Rust regex (not FTS5 syntax) for the pattern
 * argument. The SQL filters narrow the candidate set; the pattern is applied in
 * application code.
 */

import type { RipmailDb } from './db.js'
import { buildMessageFilterClause } from './filterClause.js'
import type { SearchOptions, SearchResult, SearchResultSet } from './types.js'

const MAX_PATTERN_SCAN_ROWS = 500_000

function dateRecencyBoost(daysAgo: number): number {
  const d = Math.max(0, daysAgo)
  if (d <= 1) return 10
  if (d <= 7) return 8 - d * 0.5
  if (d <= 30) return 4.5 - (d - 7) * 0.1
  if (d <= 90) return 1.2 - (d - 30) * 0.01
  return 0.6 - (d - 90) * 0.001
}

function rankReferenceMs(opts: SearchOptions): number {
  return opts.rollingAnchorDate?.getTime() ?? Date.now()
}

function combinedRank(isoDate: string, base: number, referenceMs: number): number {
  const ms = Date.parse(isoDate.replace(' ', 'T'))
  if (isNaN(ms)) return base
  const daysAgo = (referenceMs - ms) / 86_400_000
  return base - dateRecencyBoost(daysAgo)
}

function bodyPreview(text: string, maxChars = 300): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '…'
}

function snippetForMatch(haystack: string, index: number, length: number): string {
  const start = Math.max(0, index - 25)
  const end = Math.min(haystack.length, index + length + 60)
  let s = haystack.slice(start, end)
  if (start > 0) s = '…' + s
  if (end < haystack.length) s = s + '…'
  return s
}

type RankedRow = SearchResult & { _rank: number }

function filterOnlySearch(db: RipmailDb, opts: SearchOptions): { rows: RankedRow[]; total: number } {
  const fc = buildMessageFilterClause(opts)
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0

  const countSql = `SELECT COUNT(*) FROM messages m ${fc.where}`
  const total = (db.prepare(countSql).get(...fc.params) as Record<string, number>)['COUNT(*)'] ?? 0

  const sqlLimit = limit + offset + 50
  const sql = `
    SELECT m.message_id, m.thread_id, m.source_id, m.from_address, m.from_name,
           m.subject, m.date,
           COALESCE(TRIM(SUBSTR(m.body_text, 1, 200)), '') ||
             CASE WHEN LENGTH(m.body_text) > 200 THEN '…' ELSE '' END AS snippet,
           COALESCE(TRIM(SUBSTR(m.body_text, 1, 300)), '') ||
             CASE WHEN LENGTH(m.body_text) > 300 THEN '…' ELSE '' END AS body_preview
    FROM messages m
    ${fc.where}
    ORDER BY m.date DESC
    LIMIT ?
  `
  const rawRows = db.prepare(sql).all(...fc.params, sqlLimit) as Array<Record<string, unknown>>

  const rows: RankedRow[] = rawRows.map((r) => {
    const date = String(r['date'] ?? '')
    const rank = combinedRank(date, 0, rankReferenceMs(opts))
    return {
      messageId: normalizeMessageId(String(r['message_id'] ?? '')),
      threadId: normalizeMessageId(String(r['thread_id'] ?? '')),
      sourceId: String(r['source_id'] ?? ''),
      sourceKind: 'mail',
      fromAddress: String(r['from_address'] ?? ''),
      fromName: r['from_name'] != null ? String(r['from_name']) : undefined,
      subject: String(r['subject'] ?? ''),
      date,
      snippet: String(r['snippet'] ?? ''),
      bodyPreview: String(r['body_preview'] ?? ''),
      rank: 0,
      _rank: rank,
    }
  })

  rows.sort((a, b) => a._rank - b._rank)
  return { rows: rows.slice(offset, offset + limit), total }
}

/** Strip angle brackets from Message-ID to match Rust CLI output shape. */
function normalizeMessageId(id: string): string {
  return id.startsWith('<') && id.endsWith('>') ? id.slice(1, -1) : id
}

function regexSearchMail(
  db: RipmailDb,
  opts: SearchOptions,
  re: RegExp,
): RankedRow[] {
  const fc = buildMessageFilterClause(opts)
  const sql = `
    SELECT m.message_id, m.thread_id, m.source_id, m.from_address, m.from_name,
           m.subject, m.date, m.body_text
    FROM messages m
    ${fc.where}
    ORDER BY m.date DESC
  `
  const rawRows = db.prepare(sql).all(...fc.params) as Array<Record<string, unknown>>

  const matched: RankedRow[] = []
  let scanned = 0
  for (const r of rawRows) {
    if (++scanned > MAX_PATTERN_SCAN_ROWS) break
    const subject = String(r['subject'] ?? '')
    const body = String(r['body_text'] ?? '')
    const hay = `${subject}\n${body}`
    const m = re.exec(hay)
    if (!m) continue
    const snip = snippetForMatch(hay, m.index, m[0].length)
    const date = String(r['date'] ?? '')
    matched.push({
      messageId: normalizeMessageId(String(r['message_id'] ?? '')),
      threadId: normalizeMessageId(String(r['thread_id'] ?? '')),
      sourceId: String(r['source_id'] ?? ''),
      sourceKind: 'mail',
      fromAddress: String(r['from_address'] ?? ''),
      fromName: r['from_name'] != null ? String(r['from_name']) : undefined,
      subject,
      date,
      snippet: snip,
      bodyPreview: bodyPreview(body),
      rank: 0,
      _rank: combinedRank(date, 0, rankReferenceMs(opts)),
    })
  }
  matched.sort((a, b) => a._rank - b._rank || b.date.localeCompare(a.date))
  return matched
}

/** Mail-only structured filters; `after`/`before` apply to messages only, not Drive/localDir index rows. */
function fileSearchAllowed(opts: SearchOptions): boolean {
  return !opts.from?.trim() && !opts.to?.trim() && !opts.subject?.trim() && !opts.category?.trim()
}

function regexSearchFiles(
  db: RipmailDb,
  opts: SearchOptions,
  re: RegExp,
  sqlLimit: number,
): RankedRow[] {
  if (!fileSearchAllowed(opts)) return []
  const srcClause =
    (opts.sourceIds?.length ?? 0) > 0
      ? `AND di.source_id IN (${opts.sourceIds!.map(() => '?').join(', ')})`
      : ''
  const sql = `
    SELECT f.abs_path, f.source_id, di.title, di.date_iso, f.body_text, f.rel_path
    FROM files f
    JOIN document_index di ON di.source_id = f.source_id AND di.ext_id = f.rel_path AND di.kind = 'file'
    WHERE 1=1 ${srcClause}
    ORDER BY di.date_iso DESC
    LIMIT ?
  `
  const rawRows = db.prepare(sql).all(...(opts.sourceIds ?? []), sqlLimit) as Array<Record<string, unknown>>
  const matched: RankedRow[] = []
  for (const r of rawRows) {
    const absPath = String(r['abs_path'] ?? '')
    const title = String(r['title'] ?? '')
    const relPath = String(r['rel_path'] ?? '').replace(/\\/g, '/')
    const body = String(r['body_text'] ?? '')
    const date = String(r['date_iso'] ?? '')
    const hay = `${title}\n${relPath}\n${absPath}\n${body}`
    const m = re.exec(hay)
    if (!m) continue
    matched.push({
      messageId: absPath,
      threadId: '',
      sourceId: String(r['source_id'] ?? ''),
      sourceKind: 'localDir',
      fromAddress: '',
      subject: title,
      date,
      snippet: snippetForMatch(hay, m.index, m[0].length),
      bodyPreview: bodyPreview(body),
      indexedRelPath: relPath,
      rank: 0,
      _rank: combinedRank(date, 0, rankReferenceMs(opts)),
    })
  }
  return matched
}

function regexSearchGoogleDrive(
  db: RipmailDb,
  opts: SearchOptions,
  re: RegExp,
  sqlLimit: number,
): RankedRow[] {
  if (!fileSearchAllowed(opts)) return []
  const srcClause =
    (opts.sourceIds?.length ?? 0) > 0
      ? `AND di.source_id IN (${opts.sourceIds!.map(() => '?').join(', ')})`
      : ''
  const sql = `
    SELECT di.ext_id, di.source_id, di.title, di.date_iso, di.body
    FROM document_index di
    WHERE di.kind = 'googleDrive' ${srcClause}
    ORDER BY di.date_iso DESC
    LIMIT ?
  `
  const rawRows = db.prepare(sql).all(...(opts.sourceIds ?? []), sqlLimit) as Array<Record<string, unknown>>
  const matched: RankedRow[] = []
  for (const r of rawRows) {
    const extId = String(r['ext_id'] ?? '')
    const title = String(r['title'] ?? '')
    const body = String(r['body'] ?? '')
    const date = String(r['date_iso'] ?? '')
    const hay = `${title}\n${extId}\n${body}`
    const m = re.exec(hay)
    if (!m) continue
    matched.push({
      messageId: extId,
      threadId: '',
      sourceId: String(r['source_id'] ?? ''),
      sourceKind: 'googleDrive',
      fromAddress: '',
      subject: title,
      date,
      snippet: snippetForMatch(hay, m.index, m[0].length),
      bodyPreview: bodyPreview(body),
      rank: 0,
      _rank: combinedRank(date, 0, rankReferenceMs(opts)),
    })
  }
  return matched
}

/**
 * Search mail and indexed files with regex pattern + structured filters.
 * Equivalent to `ripmail search <pattern> [--from …] [--after …] … --json`.
 */
export function search(db: RipmailDb, opts: SearchOptions): SearchResultSet {
  const t0 = Date.now()
  const pattern = (opts.query ?? opts.pattern ?? '').trim()

  if (!pattern) {
    const { rows, total } = filterOnlySearch(db, opts)
    return {
      results: rows.map(({ _rank: _, ...r }) => ({ ...r })),
      timings: { totalMs: Date.now() - t0 },
      totalMatched: total,
      hints: rows.length === 0 ? ['No results for these filters.'] : [],
    }
  }

  // Validate: no legacy inline operators
  if (/\bfrom:|to:|subject:|category:/i.test(pattern)) {
    return {
      results: [],
      timings: { totalMs: Date.now() - t0 },
      totalMatched: 0,
      hints: [
        'The pattern contains inline operators (from:, to:, subject:, category:). Use the dedicated search parameters instead.',
      ],
    }
  }

  let re: RegExp
  try {
    re = new RegExp(pattern, opts.caseSensitive ? '' : 'i')
  } catch (e) {
    return {
      results: [],
      timings: { totalMs: Date.now() - t0 },
      totalMatched: 0,
      hints: [`Invalid search pattern: ${String(e)}`],
    }
  }

  const tp0 = Date.now()
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  const sqlLimit = MAX_PATTERN_SCAN_ROWS

  const fsa = fileSearchAllowed(opts)

  const mailRows = regexSearchMail(db, opts, re)
  const fileRows = fsa ? regexSearchFiles(db, opts, re, sqlLimit) : []
  const driveRows = fsa ? regexSearchGoogleDrive(db, opts, re, sqlLimit) : []

  const all = [...mailRows, ...fileRows, ...driveRows]
  all.sort((a, b) => a._rank - b._rank || b.date.localeCompare(a.date))
  const total = all.length
  const sliced = all.slice(offset, offset + limit)

  return {
    results: sliced.map(({ _rank: _, ...r }) => ({ ...r })),
    timings: { patternMs: Date.now() - tp0, totalMs: Date.now() - t0 },
    totalMatched: total,
    hints: sliced.length === 0 ? [`No matches for pattern "${pattern}".`] : [],
  }
}
