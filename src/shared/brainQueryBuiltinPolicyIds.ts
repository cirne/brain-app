/**
 * Built-in privacy prompt ids under `brain-query/privacy/<id>.hbs` (including `server-default` baseline
 * prose). {@link BRAIN_QUERY_GRANT_PRESET_IDS} is the subset that may be stored on a grant as `preset_policy_key`.
 */
export const BRAIN_QUERY_BUILTIN_POLICY_IDS = [
  'trusted',
  'general',
  'minimal-disclosure',
  'server-default',
] as const

export type BrainQueryBuiltinPolicyId = (typeof BRAIN_QUERY_BUILTIN_POLICY_IDS)[number]

/** The three named outbound presets grants may reference (`server-default` is baseline-only, not grantable). */
export const BRAIN_QUERY_GRANT_PRESET_IDS = ['trusted', 'general', 'minimal-disclosure'] as const

export type BrainQueryGrantPresetId = (typeof BRAIN_QUERY_GRANT_PRESET_IDS)[number]

export function isBrainQueryBuiltinPolicyId(s: string): s is BrainQueryBuiltinPolicyId {
  return (BRAIN_QUERY_BUILTIN_POLICY_IDS as readonly string[]).includes(s)
}

export function isBrainQueryGrantPresetId(s: string): s is BrainQueryGrantPresetId {
  return (BRAIN_QUERY_GRANT_PRESET_IDS as readonly string[]).includes(s)
}
