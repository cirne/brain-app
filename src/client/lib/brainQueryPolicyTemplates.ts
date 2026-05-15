/**
 * Named outbound privacy presets for brain-query grants (three built-ins plus saved custom policies).
 *
 * Preset **bodies** come from `GET /api/brain-query/builtin-policy-bodies` (server reads
 * `src/server/prompts/brain-query/privacy/<id>.hbs`). This module holds **i18n key paths** for preset
 * titles and one-line descriptions (see `access.policyPresets` in `access.json`).
 *
 * System-wide deny rules: {@link POLICY_ALWAYS_OMIT} in `@shared/brainQueryAnswerBaseline.js`.
 * Baseline-only prose for `server-default` is **not** a grantable `preset_policy_key`
 * (see {@link isBrainQueryGrantPresetId}).
 */

export { POLICY_ALWAYS_OMIT } from '@shared/brainQueryAnswerBaseline.js'
import type { BrainQueryBuiltinPolicyId } from '@shared/brainQueryBuiltinPolicyIds.js'
import { isBrainQueryGrantPresetId } from '@shared/brainQueryBuiltinPolicyIds.js'

export type { BrainQueryBuiltinPolicyId }

export type BrainQueryPolicyTemplate = {
  id: BrainQueryBuiltinPolicyId
  /** i18n key for short label (e.g. `$t(tpl.labelKey)`). */
  labelKey: string
  /** i18n key for one-line description. */
  hintKey: string
  /** Body that fills the policy textarea (from API / `.hbs`). */
  text: string
}

/** Static picker meta for the three grantable built-ins (bodies merged via {@link buildBrainQueryGrantPolicyTemplates}). */
export const BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META: Omit<BrainQueryPolicyTemplate, 'text'>[] = [
  {
    id: 'trusted',
    labelKey: 'access.policyPresets.trusted.label',
    hintKey: 'access.policyPresets.trusted.hint',
  },
  {
    id: 'general',
    labelKey: 'access.policyPresets.general.label',
    hintKey: 'access.policyPresets.general.hint',
  },
  {
    id: 'minimal-disclosure',
    labelKey: 'access.policyPresets.minimal-disclosure.label',
    hintKey: 'access.policyPresets.minimal-disclosure.hint',
  },
]

export function buildBrainQueryGrantPolicyTemplates(
  bodies: Record<BrainQueryBuiltinPolicyId, string>,
): BrainQueryPolicyTemplate[] {
  return BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META.map((meta) => ({
    ...meta,
    text: bodies[meta.id],
  }))
}

export function templateById(
  bodies: Record<BrainQueryBuiltinPolicyId, string>,
  id: BrainQueryBuiltinPolicyId,
): BrainQueryPolicyTemplate | undefined {
  const meta = BRAIN_QUERY_GRANT_POLICY_TEMPLATE_META.find((m) => m.id === id)
  if (meta) {
    return { ...meta, text: bodies[id] }
  }
  if (id === 'server-default') {
    return {
      id: 'server-default',
      labelKey: 'access.policyPresets.serverDefault.label',
      hintKey: 'access.policyPresets.serverDefault.hint',
      text: bodies['server-default'],
    }
  }
  return undefined
}

/** True when `id` is one of the three built-in **grant** preset keys (trusted / general / minimal-disclosure). */
export function isBrainQueryBuiltinTemplateId(id: string): boolean {
  return isBrainQueryGrantPresetId(id)
}
