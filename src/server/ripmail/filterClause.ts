/**
 * WHERE clause builder for ripmail message queries.
 * Mirrors ripmail/src/search/filter.rs build_filter_clause.
 */

import type { SearchOptions } from './types.js'

export interface FilterClause {
  /** The SQL fragment (without WHERE prefix). Empty string means "no filter". */
  where: string
  /** Positional parameters for the SQL fragment. */
  params: unknown[]
}

/** Resolve a date string: rolling specs like '7d', '30d', '1y' → ISO date */
export function resolveDate(spec: string): string {
  const s = spec.trim()
  const m = s.match(/^(\d+)(d|w|m|y)$/)
  if (!m) return s
  const n = parseInt(m[1]!, 10)
  const unit = m[2]!
  const now = new Date()
  switch (unit) {
    case 'd':
      now.setDate(now.getDate() - n)
      break
    case 'w':
      now.setDate(now.getDate() - n * 7)
      break
    case 'm':
      now.setMonth(now.getMonth() - n)
      break
    case 'y':
      now.setFullYear(now.getFullYear() - n)
      break
  }
  return now.toISOString().slice(0, 10)
}

function likePattern(s: string): string {
  return `%${s.toLowerCase()}%`
}

/**
 * Build a WHERE clause for `messages m` filtering by structured fields.
 * The `m.` alias prefix is required in the SQL.
 */
export function buildMessageFilterClause(opts: SearchOptions): FilterClause {
  const conditions: string[] = []
  const params: unknown[] = []

  const fromTrimmed = opts.from?.trim()
  const toTrimmed = opts.to?.trim()

  if (opts.fromOrToUnion && fromTrimmed && toTrimmed) {
    const pFrom = likePattern(fromTrimmed)
    const pTo = likePattern(toTrimmed)
    conditions.push(
      `((m.from_address LIKE ? OR m.from_name LIKE ?) OR (EXISTS (SELECT 1 FROM json_each(m.to_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)) OR EXISTS (SELECT 1 FROM json_each(m.cc_addresses) j WHERE LOWER(j.value) LIKE LOWER(?))))`,
    )
    params.push(pFrom, pFrom, pTo, pTo)
  } else {
    if (fromTrimmed) {
      const p = likePattern(fromTrimmed)
      conditions.push(`(m.from_address LIKE ? OR m.from_name LIKE ?)`)
      params.push(p, p)
    }
    if (toTrimmed) {
      const p = likePattern(toTrimmed)
      conditions.push(
        `(EXISTS (SELECT 1 FROM json_each(m.to_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)) OR EXISTS (SELECT 1 FROM json_each(m.cc_addresses) j WHERE LOWER(j.value) LIKE LOWER(?)))`,
      )
      params.push(p, p)
    }
  }

  const subjectTrimmed = opts.subject?.trim()
  if (subjectTrimmed) {
    conditions.push(`m.subject LIKE ?`)
    params.push(likePattern(subjectTrimmed))
  }

  const afterTrimmed = opts.afterDate?.trim()
  if (afterTrimmed) {
    const resolved = resolveDate(afterTrimmed)
    conditions.push(`m.date >= ?`)
    params.push(resolved)
  }

  const beforeTrimmed = opts.beforeDate?.trim()
  if (beforeTrimmed) {
    const resolved = resolveDate(beforeTrimmed)
    conditions.push(`m.date <= ?`)
    params.push(resolved)
  }

  const categoryTrimmed = opts.category?.trim()
  if (categoryTrimmed) {
    const cats = categoryTrimmed.split(',').map((c) => c.trim()).filter(Boolean)
    if (cats.length === 1) {
      conditions.push(`m.category = ?`)
      params.push(cats[0])
    } else if (cats.length > 1) {
      const ph = cats.map(() => '?').join(', ')
      conditions.push(`m.category IN (${ph})`)
      params.push(...cats)
    }
  }

  if (!opts.includeAll) {
    // Exclude provider categories that are noise: promotions, social, etc.
    conditions.push(
      `(m.category IS NULL OR m.category NOT IN ('promotions', 'social', 'forums', 'updates', 'spam'))`,
    )
  }

  const sourceIds = opts.sourceIds?.filter(Boolean) ?? []
  if (sourceIds.length > 0) {
    const ph = sourceIds.map(() => '?').join(', ')
    conditions.push(`m.source_id IN (${ph})`)
    params.push(...sourceIds)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}
