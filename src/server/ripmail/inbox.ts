/**
 * inbox() — deterministic rules-based inbox scan.
 * Mirrors ripmail/src/inbox/scan.rs run_inbox_scan (deterministic path only).
 *
 * The TS implementation runs the same algorithm:
 *  1. Load candidates from messages within the time window
 *  2. Apply rules.json regex + structured filters to assign rule_triage
 *  3. Fall back to heuristics when no rule matches
 *  4. Return surfaced items (notify + inform by default; all when thorough)
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RipmailDb } from './db.js'
import type { InboxItem, InboxResult, UserRule, RulesFile } from './types.js'

const DEFAULT_CANDIDATE_CAP = 80
const DEFAULT_RULES_FILE = new URL('../../../ripmail/src/rules/default_rules.v3.json', import.meta.url)

// ---------------------------------------------------------------------------
// Rules loading
// ---------------------------------------------------------------------------

const DEFAULT_RULES_JSON: RulesFile = JSON.parse(readFileSync(DEFAULT_RULES_FILE, 'utf8')) as RulesFile

export function loadRulesFile(ripmailHome: string): RulesFile {
  const path = join(ripmailHome, 'rules.json')
  if (!existsSync(path)) return DEFAULT_RULES_JSON
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as RulesFile
    if (!raw.rules || !Array.isArray(raw.rules)) return DEFAULT_RULES_JSON
    return raw
  } catch {
    return DEFAULT_RULES_JSON
  }
}

export function rulesFingerprint(file: RulesFile): string {
  return createHash('sha256').update(JSON.stringify(file.rules)).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// Noreply detection (mirrors ripmail/src/search/noreply.rs)
// ---------------------------------------------------------------------------

const NOREPLY_PATTERNS = [
  'no-reply',
  'noreply',
  'do-not-reply',
  'donotreply',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'daemon',
]

function isNoreply(address: string): boolean {
  const lower = address.toLowerCase()
  return NOREPLY_PATTERNS.some((p) => lower.includes(p))
}

// ---------------------------------------------------------------------------
// Fallback heuristic (mirrors inbox/scan.rs evaluate_fallback_heuristic)
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES = new Set(['promotional', 'social', 'forum', 'list', 'bulk', 'spam', 'automated'])
const AUTOMATED_SUBJECTS = ['newsletter', 'digest', 'sale', 'deal alert', 'sitewide', 'membership']
const AUTOMATED_SNIPPETS = [
  'view in browser',
  'view this email in your browser',
  'manage preferences',
  'manage your subscription',
  'manage email preferences',
]

function fallbackHeuristic(candidate: InboxCandidate): { action: 'notify' | 'inform' | 'ignore'; note: string } {
  if (candidate.category && EXCLUDED_CATEGORIES.has(candidate.category)) {
    return { action: 'ignore', note: 'Heuristic: list or excluded provider category.' }
  }
  const from = candidate.fromAddress.toLowerCase()
  const subject = candidate.subject.toLowerCase()
  const snippet = candidate.snippet.toLowerCase()
  if (isNoreply(from)) return { action: 'ignore', note: 'Heuristic: noreply-style sender address.' }
  if (from.includes('newsletter')) return { action: 'ignore', note: 'Heuristic: sender address looks like newsletter traffic.' }
  if (from.includes('linkedin')) return { action: 'ignore', note: 'Heuristic: sender address looks like LinkedIn traffic.' }
  if (AUTOMATED_SUBJECTS.some((n) => subject.includes(n)))
    return { action: 'ignore', note: 'Heuristic: subject suggests marketing or automated bulk mail.' }
  if (AUTOMATED_SNIPPETS.some((n) => snippet.includes(n)))
    return { action: 'ignore', note: 'Heuristic: snippet suggests list or marketing boilerplate.' }
  return { action: 'inform', note: 'Heuristic: ambiguous or non-bulk mail; defaulting to inform.' }
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

interface InboxCandidate {
  messageId: string
  sourceId: string
  date: string
  fromAddress: string
  fromName?: string
  toAddresses: string[]
  ccAddresses: string[]
  subject: string
  snippet: string
  bodyText: string
  category?: string
  threadId: string
}

function ruleMatchesCandidate(rule: UserRule, candidate: InboxCandidate): boolean {
  const { query, fromAddress, toAddress, subject, category, fromOrToUnion } = rule

  // Check category
  if (category) {
    const cats = category.split(',').map((c) => c.trim().toLowerCase())
    if (!cats.includes((candidate.category ?? '').toLowerCase())) return false
  }

  // Build from/to match
  let fromMatch = true
  let toMatch = true

  if (fromAddress) {
    const p = fromAddress.toLowerCase()
    fromMatch =
      candidate.fromAddress.toLowerCase().includes(p) ||
      (candidate.fromName?.toLowerCase().includes(p) ?? false)
  }

  if (toAddress) {
    const p = toAddress.toLowerCase()
    toMatch =
      candidate.toAddresses.some((a) => a.toLowerCase().includes(p)) ||
      candidate.ccAddresses.some((a) => a.toLowerCase().includes(p))
  }

  if (fromOrToUnion && (fromAddress || toAddress)) {
    if (!fromMatch && !toMatch) return false
  } else {
    if (fromAddress && !fromMatch) return false
    if (toAddress && !toMatch) return false
  }

  // Check subject filter
  if (subject) {
    const p = subject.toLowerCase()
    if (!candidate.subject.toLowerCase().includes(p)) return false
  }

  // Check query (regex on subject + body)
  if (query) {
    try {
      const re = new RegExp(query, 'i')
      const hay = `${candidate.subject}\n${candidate.bodyText}`
      if (!re.test(hay)) return false
    } catch {
      return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Inbox scan
// ---------------------------------------------------------------------------

function defaultCategoryFilterSql(col: string): string {
  return `(${col} IS NULL OR ${col} NOT IN ('promotional', 'social', 'forum', 'list', 'bulk', 'spam', 'automated'))`
}

function parseSinceToIso(since: string): string {
  const resolved = since.trim()
  // If looks like a number with unit (24h, 7d, etc.)
  const hoursMatch = resolved.match(/^(\d+)h$/)
  if (hoursMatch) {
    const h = parseInt(hoursMatch[1]!, 10)
    const d = new Date(Date.now() - h * 3_600_000)
    return d.toISOString()
  }
  const daysMatch = resolved.match(/^(\d+)d$/)
  if (daysMatch) {
    const d = new Date()
    d.setDate(d.getDate() - parseInt(daysMatch[1]!, 10))
    return d.toISOString().slice(0, 10)
  }
  // ISO date or datetime — pass through
  return resolved
}

export interface InboxOptions {
  /** e.g. '24h', '7d', or ISO datetime. Default: '24h'. */
  since?: string
  thorough?: boolean
  sourceIds?: string[]
  rulesFingerprint?: string
  ownerAddress?: string
}

export function inbox(db: RipmailDb, ripmailHome: string, opts?: InboxOptions): InboxResult {
  const since = opts?.since ?? '24h'
  const cutoffIso = parseSinceToIso(since)
  const thorough = opts?.thorough ?? false
  const candidateCap = DEFAULT_CANDIDATE_CAP
  const sourceIds = opts?.sourceIds ?? []

  const categoryFilter = thorough ? '' : ` AND ${defaultCategoryFilterSql('category')}`
  const archivedFilter = thorough ? '' : ` AND is_archived = 0`
  const sourceFilter =
    sourceIds.length > 0 ? ` AND source_id IN (${sourceIds.map(() => '?').join(', ')})` : ''

  const fetchLimit = Math.min(candidateCap * 2, 200)
  const sql = `
    SELECT message_id, thread_id, source_id, from_address, from_name,
           to_addresses, cc_addresses, subject, date,
           COALESCE(TRIM(SUBSTR(body_text, 1, 200)), '') ||
             CASE WHEN LENGTH(TRIM(body_text)) > 200 THEN '…' ELSE '' END AS snippet,
           COALESCE(body_text, '') AS body_text,
           category
    FROM messages
    WHERE date >= ?
      ${archivedFilter}${categoryFilter}${sourceFilter}
    ORDER BY date DESC
    LIMIT ?
  `
  const bindParams: unknown[] = [cutoffIso, ...sourceIds, fetchLimit]
  const rawRows = db.prepare(sql).all(...bindParams) as Array<Record<string, unknown>>

  const candidates: InboxCandidate[] = rawRows.slice(0, candidateCap).map((r) => ({
    messageId: String(r['message_id'] ?? ''),
    sourceId: String(r['source_id'] ?? ''),
    threadId: String(r['thread_id'] ?? ''),
    date: String(r['date'] ?? ''),
    fromAddress: String(r['from_address'] ?? ''),
    fromName: r['from_name'] != null ? String(r['from_name']) : undefined,
    toAddresses: parseJsonArr(String(r['to_addresses'] ?? '[]')),
    ccAddresses: parseJsonArr(String(r['cc_addresses'] ?? '[]')),
    subject: String(r['subject'] ?? ''),
    snippet: String(r['snippet'] ?? ''),
    bodyText: String(r['body_text'] ?? ''),
    category: r['category'] != null ? String(r['category']) : undefined,
  }))

  const rulesFile = loadRulesFile(ripmailHome)
  const fp = opts?.rulesFingerprint ?? rulesFingerprint(rulesFile)

  // Apply rules and build items
  const items: InboxItem[] = []
  const counts = { notify: 0, inform: 0, ignore: 0, actionRequired: 0 }

  for (const c of candidates) {
    let action: 'notify' | 'inform' | 'ignore'
    let matchedRuleIds: string[] = []
    let winningRuleId: string | undefined
    let decisionSource: string | undefined
    let note: string | undefined

    // Check for cached decision
    const cached = db
      .prepare(
        `SELECT action, matched_rule_ids, note, decision_source
         FROM inbox_decisions
         WHERE message_id = ? AND rules_fingerprint = ?`,
      )
      .get(c.messageId, fp) as Record<string, unknown> | undefined

    if (cached && !thorough) {
      action = String(cached['action'] ?? 'inform') as 'notify' | 'inform' | 'ignore'
      matchedRuleIds = parseJsonArr(String(cached['matched_rule_ids'] ?? '[]'))
      note = cached['note'] != null ? String(cached['note']) : undefined
      decisionSource = 'cached'
    } else {
      // Apply rules in order
      let matched: UserRule | undefined
      const allMatched: string[] = []
      for (const rule of rulesFile.rules) {
        if (ruleMatchesCandidate(rule, c)) {
          allMatched.push(rule.id)
          if (!matched) matched = rule
        }
      }

      if (matched) {
        action = matched.action
        matchedRuleIds = allMatched
        winningRuleId = matched.id
        decisionSource = 'rule'
        note = matched.description ?? `Matched user rule: ${matched.id}`
      } else {
        const fb = fallbackHeuristic(c)
        action = fb.action
        decisionSource = 'fallback'
        note = fb.note
      }

      // Persist decision
      try {
        db
          .prepare(
            `INSERT OR REPLACE INTO inbox_decisions
             (message_id, rules_fingerprint, action, matched_rule_ids, note, decision_source)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(c.messageId, fp, action, JSON.stringify(matchedRuleIds), note ?? null, decisionSource)
      } catch {
        // Non-fatal
      }
    }

    counts[action]++

    // Surface: notify + inform always; ignore only in thorough mode
    if (action === 'ignore' && !thorough) continue

    items.push({
      messageId: c.messageId,
      sourceId: c.sourceId,
      fromAddress: c.fromAddress,
      fromName: c.fromName,
      subject: c.subject,
      date: c.date,
      snippet: c.snippet,
      category: c.category,
      action,
      matchedRuleIds,
      winningRuleId,
      decisionSource,
      note,
      requiresUserAction: false,
    })
  }

  return { items, counts }
}

function parseJsonArr(s: string): string[] {
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
