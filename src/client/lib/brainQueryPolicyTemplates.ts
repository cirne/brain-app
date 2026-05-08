/**
 * Starter privacy-policy templates for the brain-query grant editor.
 *
 * Plain-text starters that prefill the per-grant privacy field. System-wide
 * deny rules: {@link POLICY_ALWAYS_OMIT} in `@shared/brainQueryAnswerBaseline.js`
 * (shown in the Brain access UI).
 */

export { POLICY_ALWAYS_OMIT } from '@shared/brainQueryAnswerBaseline.js'

export type BrainQueryBuiltInPolicyId = 'trusted' | 'general' | 'minimal-disclosure'

export type BrainQueryPolicyTemplate = {
  id: BrainQueryBuiltInPolicyId
  /** Short label in the picker. */
  label: string
  /** One-line description shown beneath the label. */
  hint: string
  /** Body that fills the policy textarea. */
  text: string
}

export const BRAIN_QUERY_POLICY_TEMPLATES: BrainQueryPolicyTemplate[] = [
  {
    id: 'trusted',
    label: 'Trusted Confidante',
    hint: 'Rich personal and work coordination; keep dollars, accounts, and long quotes light.',
    text: [
      'ALLOWED: Calendar and travel logistics; meeting titles, times, and locations; attendee names and roles when useful; project and work context; people and relationships that matter for coordination; general personal logistics (e.g. childcare pickup, dinner plans) when it is ordinary scheduling or social context—not medical, credential, or identifier detail.',
      'OMIT: Specific dollar amounts, account numbers, transaction lines, or investment positions; long verbatim quotes from mail or messages when a short paraphrase is enough.',
    ].join('\n\n'),
  },
  {
    id: 'general',
    label: 'General collaborator',
    hint: 'Work-focused; leave personal life out unless one minimal fact is required for the task.',
    text: [
      'ALLOWED: Professional and work context: active projects, deadlines, meeting subjects, workplace decisions, and named colleagues or contacts when needed for the work topic.',
      'OMIT: Non-work personal life by default: family and household detail, health and medical topics, finances and major purchases, housing, religion, politics, hobbies, and social relationships—unless one minimal fact is strictly required to answer a work-scoped question and is not credential, identifier, or clinical content.',
      'Prefer summaries over long specifics; avoid quoting mail or documents verbatim when paraphrase suffices.',
    ].join('\n\n'),
  },
  {
    id: 'minimal-disclosure',
    label: 'Minimal disclosure',
    hint: 'Thin, literal answers only—no backstory, extra names, or calendar padding unless the question truly requires it.',
    text: [
      'ALLOWED: Only the minimum facts, names, dates, or amounts required so the answer is still true and usable. If a careful answer is possible without naming people or places, omit them.',
      'OMIT: Background, related projects, secondary participants, opinions, and any detail not strictly required for the ask. Do not add calendar or personal context beyond what the question requires.',
    ].join('\n\n'),
  },
]

export function templateById(id: BrainQueryBuiltInPolicyId): BrainQueryPolicyTemplate | undefined {
  return BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === id)
}
