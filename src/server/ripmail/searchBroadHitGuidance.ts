/**
 * Structured machine-readable hints when the mailbox matched **many** rows —
 * mirror of zero-hit guidance (stable IDs, no locale-specific branching prose).
 */
import type { SearchOptions, SearchResultSet } from './types.js'

/** More matches exist than fit one returned page (`totalMatched > limit`). */
export const HIGH_RECALL_TOTAL_EXCEEDS_PAGE = 'high_recall_total_exceeds_page'
/** Large absolute pool even when limit is high (`totalMatched >=` threshold). */
export const HIGH_RECALL_LARGE_POOL = 'high_recall_large_pool'

/** Add `after` / lower bound when omitted — narrows candidate mail/doc corpus. */
export const NARROW_ADD_AFTER_DATE = 'add_after_date'
export const NARROW_ADD_BEFORE_DATE = 'add_before_date'
export const NARROW_ADD_FROM_FILTER = 'add_from_filter'
export const NARROW_ADD_TO_FILTER = 'add_to_filter'
export const NARROW_ADD_SUBJECT_FILTER = 'add_subject_filter'
/** Pattern searches only — constrain regex after tightening structured filters. */
export const NARROW_TIGHTEN_BODY_REGEX = 'tighten_body_regex'

/** When pool is huge despite a generous limit (avoid silent omission when limit ≥ totalMatched edge cases). */
export const HIGH_RECALL_ABSOLUTE_MIN = 50

export function isHighRecallSearch(totalMatched: number, optsLimit: number): boolean {
  if (totalMatched <= 0) return false
  return totalMatched > optsLimit || totalMatched >= HIGH_RECALL_ABSOLUTE_MIN
}

export type RecallReasonId =
  | typeof HIGH_RECALL_TOTAL_EXCEEDS_PAGE
  | typeof HIGH_RECALL_LARGE_POOL

export function buildBroadRecallGuidance(
  opts: SearchOptions,
  patternTrimmed: string,
  totalMatched: number,
  resultsReturned: number,
): Pick<SearchResultSet, 'recallSummary' | 'suggestedNarrowings'> | undefined {
  const optsLimit = opts.limit ?? 50
  if (!isHighRecallSearch(totalMatched, optsLimit)) return undefined

  const reasons: RecallReasonId[] = []
  if (totalMatched > optsLimit) reasons.push(HIGH_RECALL_TOTAL_EXCEEDS_PAGE)
  if (totalMatched >= HIGH_RECALL_ABSOLUTE_MIN) reasons.push(HIGH_RECALL_LARGE_POOL)

  const recallSummary: NonNullable<SearchResultSet['recallSummary']> = {
    totalMatched,
    resultsReturned,
    reasons,
    limit: optsLimit,
    ...(opts.offset != null && opts.offset > 0 ? { offset: opts.offset } : {}),
  }

  const hasPattern = Boolean(patternTrimmed)
  const suggestedNarrowings: string[] = []
  if (!opts.afterDate?.trim()) suggestedNarrowings.push(NARROW_ADD_AFTER_DATE)
  if (!opts.beforeDate?.trim()) suggestedNarrowings.push(NARROW_ADD_BEFORE_DATE)
  if (!opts.from?.trim()) suggestedNarrowings.push(NARROW_ADD_FROM_FILTER)
  if (!opts.to?.trim()) suggestedNarrowings.push(NARROW_ADD_TO_FILTER)
  if (!opts.subject?.trim()) suggestedNarrowings.push(NARROW_ADD_SUBJECT_FILTER)
  if (hasPattern) suggestedNarrowings.push(NARROW_TIGHTEN_BODY_REGEX)

  return { recallSummary, suggestedNarrowings }
}
