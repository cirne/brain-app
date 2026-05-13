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
      'Prefer paraphrase over long verbatim quotes from mail or documents when the content is sensitive; still give a complete answer to the work question in one reply.',
    ].join('\n\n'),
  },
  {
    id: 'minimal-disclosure',
    label: 'Minimal disclosure',
    hint: 'Smallest privacy surface: omit sensitive names, places, and backstory when the question can still be answered truthfully—this is not an excuse for one-line non-answers.',
    text: [
      'ALLOWED: Enough facts, names, dates, or amounts that the answer stays true and usable in one message. Minimize sensitive identifiers: if the question can be answered without naming a person or place, omit them.',
      'OMIT: Extra background, unrelated projects, secondary participants, opinions, and any sensitive detail not needed for the ask. This limits what crosses the tunnel—not how “chatty” the model sounds; still answer the question completely within those bounds.',
    ].join('\n\n'),
  },
]

export function templateById(id: BrainQueryBuiltInPolicyId): BrainQueryPolicyTemplate | undefined {
  return BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === id)
}
