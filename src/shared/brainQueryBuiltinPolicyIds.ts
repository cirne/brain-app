/**
 * Built-in brain-query privacy policy ids: stored on grants as `preset_policy_key`, resolved from
 * `brain-query/privacy/<id>.hbs`. `server-default` matches {@link DEFAULT_BRAIN_QUERY_PRIVACY_POLICY}.
 */
export const BRAIN_QUERY_BUILTIN_POLICY_IDS = [
  'trusted',
  'general',
  'minimal-disclosure',
  'server-default',
] as const

export type BrainQueryBuiltinPolicyId = (typeof BRAIN_QUERY_BUILTIN_POLICY_IDS)[number]

export function isBrainQueryBuiltinPolicyId(s: string): s is BrainQueryBuiltinPolicyId {
  return (BRAIN_QUERY_BUILTIN_POLICY_IDS as readonly string[]).includes(s)
}
