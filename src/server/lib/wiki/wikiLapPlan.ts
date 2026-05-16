/**
 * Structured lap plan from the wiki Survey agent (JSON). Validated server-side before Execute.
 */

import { openRipmailDb, closeRipmailDb } from '@server/ripmail/db.js'
import { ripmailHomeForBrain } from '@server/lib/platform/brainHome.js'
import { WIKI_LAP_PLAN_CAP } from '@shared/wikiLap.js'

export type WikiLapPlanNewPage = {
  path: string
  kind: string
  evidenceSummary: string
  evidenceMessageIds: string[]
  expectedSections?: string[]
}

export type WikiLapPlanDeepen = {
  path: string
  currentGaps: string[]
  indexSignals: string
  evidenceMessageIds: string[]
}

export type WikiLapPlanRefresh = {
  path: string
  staleClaim: string
  evidenceMessageIds: string[]
}

export type WikiLapPlanSkipped = {
  path: string
  reason: string
}

export type WikiLapPlan = {
  idle: boolean
  reasoning: string
  newPages: WikiLapPlanNewPage[]
  deepens: WikiLapPlanDeepen[]
  refreshes: WikiLapPlanRefresh[]
  skipped: WikiLapPlanSkipped[]
}

const ALLOWED_NEW_PREFIXES = [
  'people/',
  'projects/',
  'topics/',
  'travel/',
  'notes/',
] as const

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, '/').trim().replace(/^\.\/+/, '').replace(/^\/+/, '')
}

export function isAllowedPlanWritePath(rel: string): boolean {
  const n = normalizeRelPath(rel).toLowerCase()
  if (!n.endsWith('.md')) return false
  if (n === 'index.md' || n === 'me.md' || n === 'assistant.md') return false
  return ALLOWED_NEW_PREFIXES.some((pre) => n.startsWith(pre))
}

/** Extract JSON object from assistant text (final ```json block or first `{`…`}`). */
export function parseWikiLapPlanFromModelText(text: string): WikiLapPlan | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  let candidate = ''
  while ((m = fence.exec(trimmed)) !== null) {
    const inner = m[1]?.trim() ?? ''
    if (inner.startsWith('{')) candidate = inner
  }
  if (!candidate) {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) candidate = trimmed.slice(start, end + 1)
  }
  if (!candidate) return null
  try {
    const raw = JSON.parse(candidate) as unknown
    return normalizeWikiLapPlan(raw)
  } catch {
    return null
  }
}

function coerceStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim())
}

function resolveMessageIdInDb(db: ReturnType<typeof openRipmailDb>, messageId: string): string | null {
  const stmt = db.prepare(`SELECT message_id FROM messages WHERE message_id = ? LIMIT 1`)
  const raw = stmt.get(messageId) as { message_id: string } | undefined
  if (raw) return raw.message_id
  if (!messageId.startsWith('<')) {
    const br = stmt.get(`<${messageId}>`) as { message_id: string } | undefined
    if (br) return br.message_id
  }
  if (messageId.startsWith('<') && messageId.endsWith('>')) {
    const nb = stmt.get(messageId.slice(1, -1)) as { message_id: string } | undefined
    if (nb) return nb.message_id
  }
  return null
}

function canonicalizeEvidenceIds(
  db: ReturnType<typeof openRipmailDb> | null,
  messageIds: string[],
): string[] {
  if (!db) return [...messageIds]
  const out: string[] = []
  for (const id of messageIds) {
    const c = resolveMessageIdInDb(db, id)
    if (c) out.push(c)
  }
  return out
}

export type WikiLapPlanValidation = { ok: true; plan: WikiLapPlan } | { ok: false; error: string }

export function normalizeWikiLapPlan(raw: unknown): WikiLapPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const idle = o.idle === true
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning.trim() : ''

  const newPages: WikiLapPlanNewPage[] = []
  if (Array.isArray(o.newPages)) {
    for (const item of o.newPages) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const path = typeof p.path === 'string' ? normalizeRelPath(p.path) : ''
      const kind = typeof p.kind === 'string' ? p.kind.trim() : 'note'
      const evidenceSummary = typeof p.evidenceSummary === 'string' ? p.evidenceSummary.trim() : ''
      const evidenceMessageIds = coerceStringArray(p.evidenceMessageIds)
      const expectedSections = Array.isArray(p.expectedSections)
        ? coerceStringArray(p.expectedSections)
        : undefined
      if (!path || !evidenceSummary || evidenceMessageIds.length === 0) continue
      if (!isAllowedPlanWritePath(path)) continue
      newPages.push({
        path,
        kind,
        evidenceSummary,
        evidenceMessageIds,
        ...(expectedSections && expectedSections.length ? { expectedSections } : {}),
      })
    }
  }

  const deepens: WikiLapPlanDeepen[] = []
  if (Array.isArray(o.deepens)) {
    for (const item of o.deepens) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const path = typeof p.path === 'string' ? normalizeRelPath(p.path) : ''
      const currentGaps = Array.isArray(p.currentGaps) ? coerceStringArray(p.currentGaps) : []
      const indexSignals = typeof p.indexSignals === 'string' ? p.indexSignals.trim() : ''
      const evidenceMessageIds = coerceStringArray(p.evidenceMessageIds)
      if (!path || !indexSignals || evidenceMessageIds.length === 0) continue
      if (!path.endsWith('.md')) continue
      deepens.push({ path, currentGaps, indexSignals, evidenceMessageIds })
    }
  }

  const refreshes: WikiLapPlanRefresh[] = []
  if (Array.isArray(o.refreshes)) {
    for (const item of o.refreshes) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const path = typeof p.path === 'string' ? normalizeRelPath(p.path) : ''
      const staleClaim = typeof p.staleClaim === 'string' ? p.staleClaim.trim() : ''
      const evidenceMessageIds = coerceStringArray(p.evidenceMessageIds)
      if (!path || !staleClaim || evidenceMessageIds.length === 0) continue
      if (!path.endsWith('.md')) continue
      refreshes.push({ path, staleClaim, evidenceMessageIds })
    }
  }

  const skipped: WikiLapPlanSkipped[] = []
  if (Array.isArray(o.skipped)) {
    for (const item of o.skipped) {
      if (!item || typeof item !== 'object') continue
      const p = item as Record<string, unknown>
      const path = typeof p.path === 'string' ? normalizeRelPath(p.path) : ''
      const reason = typeof p.reason === 'string' ? p.reason.trim() : ''
      if (path && reason) skipped.push({ path, reason })
    }
  }

  return {
    idle,
    reasoning,
    newPages,
    deepens,
    refreshes,
    skipped,
  }
}

/** Filter evidence IDs to indexed mail; drop items that lose all ids; cap total work items. */
export function validateAndSanitizeWikiLapPlan(plan: WikiLapPlan): WikiLapPlanValidation {
  if (plan.idle) {
    return { ok: true, plan: { ...plan, newPages: [], deepens: [], refreshes: [] } }
  }

  let db: ReturnType<typeof openRipmailDb> | null = null
  try {
    db = openRipmailDb(ripmailHomeForBrain())
  } catch {
    /* no ripmail DB (e.g. some tests) — evidence validation becomes no-op */
  }

  try {
    const newPages: WikiLapPlanNewPage[] = []
    for (const np of plan.newPages) {
      const ids = canonicalizeEvidenceIds(db, np.evidenceMessageIds)
      if (ids.length === 0) continue
      newPages.push({ ...np, evidenceMessageIds: ids })
    }

    const deepens: WikiLapPlanDeepen[] = []
    for (const d of plan.deepens) {
      const ids = canonicalizeEvidenceIds(db, d.evidenceMessageIds)
      if (ids.length === 0) continue
      deepens.push({ ...d, evidenceMessageIds: ids })
    }

    const refreshes: WikiLapPlanRefresh[] = []
    for (const r of plan.refreshes) {
      const ids = canonicalizeEvidenceIds(db, r.evidenceMessageIds)
      if (ids.length === 0) continue
      refreshes.push({ ...r, evidenceMessageIds: ids })
    }

    const workCount = newPages.length + deepens.length + refreshes.length
    if (workCount > WIKI_LAP_PLAN_CAP) {
      return { ok: false, error: `Plan exceeds cap (${workCount} > ${WIKI_LAP_PLAN_CAP})` }
    }

    if (workCount === 0 && !plan.idle) {
      return {
        ok: true,
        plan: {
          ...plan,
          idle: true,
          reasoning: plan.reasoning || 'No actionable items after evidence validation',
          newPages: [],
          deepens: [],
          refreshes: [],
        },
      }
    }

    return {
      ok: true,
      plan: {
        ...plan,
        idle: false,
        newPages,
        deepens,
        refreshes,
      },
    }
  } finally {
    if (db) closeRipmailDb(ripmailHomeForBrain())
  }
}

export function formatPlanForExecutePrompt(plan: WikiLapPlan): string {
  return [
    '## Wiki lap plan (execute exactly this)',
    '',
    '**Reasoning (survey):**',
    plan.reasoning || '(none)',
    '',
    '### New pages (`write` allowed only for these paths)',
    JSON.stringify(plan.newPages, null, 2),
    '',
    '### Deepen (`edit` only)',
    JSON.stringify(plan.deepens, null, 2),
    '',
    '### Refresh stale claims (`edit` only)',
    JSON.stringify(plan.refreshes, null, 2),
    '',
    'Do **not** add paths outside **New pages**. For deepen/refresh, only **edit** listed paths.',
  ].join('\n')
}

export function collectPlanTargetPaths(plan: WikiLapPlan): string[] {
  const s = new Set<string>()
  for (const p of plan.newPages) s.add(p.path)
  for (const p of plan.deepens) s.add(p.path)
  for (const p of plan.refreshes) s.add(p.path)
  return [...s].sort()
}

export function writeAllowlistFromPlan(plan: WikiLapPlan): Set<string> {
  const set = new Set<string>()
  for (const p of plan.newPages) {
    set.add(normalizeRelPath(p.path).toLowerCase())
  }
  return set
}

function normKey(p: string): string {
  return normalizeRelPath(p).toLowerCase()
}

/** Map vault-relative path → evidence message ids from the plan. */
export function evidenceIdsByPathFromPlan(plan: WikiLapPlan): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const p of plan.newPages) m.set(normKey(p.path), [...p.evidenceMessageIds])
  for (const p of plan.deepens) m.set(normKey(p.path), [...p.evidenceMessageIds])
  for (const p of plan.refreshes) m.set(normKey(p.path), [...p.evidenceMessageIds])
  return m
}
