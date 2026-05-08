/**
 * Starter privacy-policy templates for the brain-query grant editor.
 *
 * Templates are *plain text starters* that prefill the existing per-grant
 * privacy textarea — no schema or backend changes. The user can keep, edit, or
 * replace the text before saving. We intentionally keep wording user-facing
 * (no tool names) since the policy is consumed downstream by the assistant as
 * natural-language guidance.
 */
export type BrainQueryBuiltInPolicyId = 'trusted' | 'general' | 'need-to-know'

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
    hint: 'High trust for coordination; still avoid passwords, raw financial/medical details.',
    text: [
      'This person has my full trust (personal assistant, spouse, or similar). Share detailed, helpful answers when they ask.',
      'You may include calendar details, travel plans, meeting context, and relevant notes so they can coordinate with me.',
      'Include names, times, places, and background when it helps them support me effectively.',
      'Never share passwords, passphrases, API keys, MFA or one-time codes, recovery phrases, or anything that could be used to access my accounts — even for a trusted person. If they ask, say those are off-limits and they should get that from me directly.',
      'Do not share full financial identifiers (bank or brokerage account numbers, card numbers, tax IDs) or verbatim financial statements. High-level context is fine when needed (e.g. “flight Tuesday,” “call the accountant”) without reproducing balances, account numbers, or transaction details.',
      'Treat medical and health information carefully: avoid diagnoses, prescriptions, or clinical details unless clearly necessary to answer their question; routine scheduling (“doctor visit Wednesday”) is fine.',
      'When in doubt about coordination and logistics, prefer being helpful and specific over redacting — but never relax the guardrails above for credentials or unnecessarily sensitive medical or financial detail.',
    ].join('\n\n'),
  },
  {
    id: 'general',
    label: 'General collaborator',
    hint: 'Helpful work answers; skip unrelated personal life.',
    text: [
      'Share helpful summaries about my work, projects, and meetings with this person.',
      'Skip unrelated personal life details (health, relationships, finances) unless they are clearly relevant to a question they’re asking.',
      'When in doubt, prefer a short, polite answer over disclosing detail.',
    ].join('\n\n'),
  },
  {
    id: 'need-to-know',
    label: 'Need-to-know only',
    hint: 'Direct answers; sensitive context only when essential.',
    text: [
      'Answer directly and briefly. Provide only the specific information needed to answer the question.',
      'Do not include broader context, opinions, or related material unless the question explicitly asks for it.',
      'Decline politely if a question would require sharing sensitive context that is not essential to the answer.',
    ].join('\n\n'),
  },
]

export function templateById(id: BrainQueryBuiltInPolicyId): BrainQueryPolicyTemplate | undefined {
  return BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === id)
}
