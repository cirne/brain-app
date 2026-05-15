import { resolveBuiltinPolicyBody } from '@server/lib/brainQuery/resolveGrantPrivacyInstructions.js'
import {
  BRAIN_QUERY_BUILTIN_POLICY_IDS,
  type BrainQueryBuiltinPolicyId,
} from '@shared/brainQueryBuiltinPolicyIds.js'

/** Built-in privacy policy prose from `brain-query/privacy/<id>.hbs` (single source of truth on disk). */
export function getBuiltinPolicyBodiesFromDisk(): Record<BrainQueryBuiltinPolicyId, string> {
  const out = {} as Record<BrainQueryBuiltinPolicyId, string>
  for (const id of BRAIN_QUERY_BUILTIN_POLICY_IDS) {
    out[id] = resolveBuiltinPolicyBody(id)
  }
  return out
}
