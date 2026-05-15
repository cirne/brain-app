/**
 * Structured machine-readable fields when a search returns no matches (`totalMatched === 0`).
 * Stable relaxation IDs — no locale-specific prose in heuristics.
 */
import type {
  EffectiveSearchSnapshot,
  SearchConstraintsPresent,
  SearchOptions,
  SearchResultSet,
} from './types.js'

/** Retry with case-insensitive regex (pattern searches only). */
export const RELAXATION_CASE_INSENSITIVE = 'case_insensitive'
/** Widen recall by omitting the lower date bound (`after` / `afterDate`). */
export const RELAXATION_REMOVE_AFTER = 'remove_after'
/** Widen recall by omitting the upper date bound (`before` / `beforeDate`). */
export const RELAXATION_REMOVE_BEFORE = 'remove_before'

export function buildStructuredZeroHitGuidance(
  opts: SearchOptions,
  patternTrimmed: string,
): Pick<SearchResultSet, 'effectiveSearch' | 'suggestedRelaxations' | 'constraintsPresent'> {
  const hasPattern = Boolean(patternTrimmed)
  const after = opts.afterDate?.trim()
  const before = opts.beforeDate?.trim()
  const from = opts.from?.trim()
  const to = opts.to?.trim()
  const subject = opts.subject?.trim()
  const category = opts.category?.trim()

  const effectiveSearch: EffectiveSearchSnapshot = {}
  if (hasPattern) effectiveSearch.pattern = patternTrimmed
  if (from) effectiveSearch.from = from
  if (to) effectiveSearch.to = to
  if (after) effectiveSearch.after = after
  if (before) effectiveSearch.before = before
  if (subject) effectiveSearch.subject = subject
  if (category) effectiveSearch.category = category
  if (opts.caseSensitive === true) effectiveSearch.caseSensitive = true
  if (opts.limit != null) effectiveSearch.limit = opts.limit
  if (opts.offset != null && opts.offset > 0) effectiveSearch.offset = opts.offset
  if ((opts.sourceIds?.length ?? 0) > 0) effectiveSearch.sourceIds = [...opts.sourceIds!]

  const constraintsPresent: SearchConstraintsPresent = {
    hasPattern,
    caseSensitive: opts.caseSensitive === true,
    hasAfterDate: Boolean(after),
    hasBeforeDate: Boolean(before),
    hasFrom: Boolean(from),
    hasTo: Boolean(to),
    hasSubject: Boolean(subject),
    hasCategory: Boolean(category),
    hasSourceIds: (opts.sourceIds?.length ?? 0) > 0,
  }

  const suggestedRelaxations: string[] = []
  if (hasPattern && opts.caseSensitive === true) suggestedRelaxations.push(RELAXATION_CASE_INSENSITIVE)
  if (after) suggestedRelaxations.push(RELAXATION_REMOVE_AFTER)
  if (before) suggestedRelaxations.push(RELAXATION_REMOVE_BEFORE)

  return { effectiveSearch, suggestedRelaxations, constraintsPresent }
}
