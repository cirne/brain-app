/**
 * Starter privacy-policy templates for the brain-query grant editor.
 *
 * Plain-text starters that prefill the per-grant privacy field. System-wide
 * deny rules: {@link POLICY_ALWAYS_OMIT} in `@shared/brainQueryAnswerBaseline.js`
 * (shown in the Tunnels UI in Settings).
 */

export { POLICY_ALWAYS_OMIT } from '@shared/brainQueryAnswerBaseline.js'
import { BRAIN_QUERY_BUILTIN_POLICY_BODIES } from '@shared/brainQueryBuiltinPolicyBodies.js'
import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'

export type { BrainQueryBuiltinPolicyId }

export type BrainQueryPolicyTemplate = {
  id: BrainQueryBuiltinPolicyId
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
    hint: 'Permissive outbound fence: few deny categories beyond baseline—blocks secrets, plumbing, and intimate third-party spillover; not a “how detailed” knob.',
    text: BRAIN_QUERY_BUILTIN_POLICY_BODIES.trusted,
  },
  {
    id: 'general',
    label: 'General collaborator',
    hint: 'Mid preset: baseline + trusted denies, plus strip courtesy pings/rumor noise and internal codenames when schedules don’t need the label.',
    text: BRAIN_QUERY_BUILTIN_POLICY_BODIES.general,
  },
  {
    id: 'minimal-disclosure',
    label: 'Minimal disclosure',
    hint: 'Tight fence: drop codenames, optional narrative, and assistant-meta clutter by default while keeping honest gist.',
    text: BRAIN_QUERY_BUILTIN_POLICY_BODIES['minimal-disclosure'],
  },
  {
    id: 'server-default',
    label: 'Server default',
    hint: 'Baseline rules when no named preset is selected (collaboration handshake default).',
    text: BRAIN_QUERY_BUILTIN_POLICY_BODIES['server-default'],
  },
]

export function templateById(id: BrainQueryBuiltinPolicyId): BrainQueryPolicyTemplate | undefined {
  return BRAIN_QUERY_POLICY_TEMPLATES.find((t) => t.id === id)
}

export function isBrainQueryBuiltinTemplateId(id: string): boolean {
  return BRAIN_QUERY_POLICY_TEMPLATES.some((t) => t.id === id)
}
