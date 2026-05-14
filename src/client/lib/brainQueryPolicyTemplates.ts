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
    hint: 'Rich, specific answers for whatever was asked—social plans or serious topics—still respect Brain access never-pass categories.',
    text: [
      'ALLOWED: Concrete detail from permitted sources (mail, calendar, wiki, and other tools the grant allows) whenever it serves the question: people, times, places, titles, themes, decisions, and logistics—whether the ask is social coordination, household planning, travel, finance-related context, or anything else the owner would reasonably share with a confidant.',
      'OMIT: Anything in the workspace baseline “never pass through” list (credentials, full financial identifiers, clinical health, identity-recovery facts, unrelated third-party private conversations, privileged legal material)—see Brain access UI. Within this grant, also omit: specific dollar amounts, account or transaction lines, or investment positions unless the question clearly needs a number; long verbatim quotes from mail or documents when a short paraphrase is enough; raw tool or mail plumbing (internal message ids, headers, filesystem paths).',
    ].join('\n\n'),
  },
  {
    id: 'general',
    label: 'General collaborator',
    hint: 'Answer the question fully; stay close to the ask; avoid unrelated sensitive or intimate tangents.',
    text: [
      'ALLOWED: A complete, useful reply grounded in permitted mail, calendar, wiki, and other tools. Include names, times, places, and concrete facts when they answer what was asked—personal coordination is fine when the question is personal; business or public-context detail is fine when the question goes there.',
      'OMIT: Drift into sensitive categories the question did not require: clinical health, credentials, full financial identifiers, unrelated intimate detail about third parties, or other baseline never-pass content (see Brain access). Prefer paraphrase over long verbatim of sensitive source material. Skip hobby, political, or social backstory unless it is needed to answer.',
      'Still give one coherent answer that covers the ask without padding unrelated topics.',
    ].join('\n\n'),
  },
  {
    id: 'minimal-disclosure',
    label: 'Minimal disclosure',
    hint: 'Smallest truthful surface—often high-level or brief; judgment beats padding.',
    text: [
      'ALLOWED: A truthful answer with the narrowest disclosure: a short summary or a few key facts is often enough. Add names, times, places, or numbers only when omitting them would mislead or dodge the question.',
      'OMIT: Backstory, side threads, rumor, editorializing, and any detail that does not change what the requester can fairly conclude. For coordination-style questions, prefer the smallest truthful sketch (e.g. that plans exist and roughly when) over guest lists, venues, or play-by-play unless those specifics are essential to the ask. Brevity is success when still honest. Raw tool or mail plumbing is never allowed.',
    ].join('\n\n'),
  },
]

export function templateById(id: BrainQueryBuiltInPolicyId): BrainQueryPolicyTemplate | undefined {
  return BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === id)
}
