import type { B2BGrantPolicy } from '@server/agent/b2bAgent.js'
import { readPromptFile } from '@server/lib/prompts/render.js'
import { getBrainQueryCustomPolicyById } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'
import type { BrainQueryGrantRow } from '@server/lib/brainQuery/brainQueryGrantsRepo.js'
import {
  type BrainQueryBuiltinPolicyId,
  isBrainQueryBuiltinPolicyId,
} from '@shared/brainQueryBuiltinPolicyIds.js'

/** Relative to prompts root. */
function builtinPolicyHbsRel(id: BrainQueryBuiltinPolicyId): string {
  return `brain-query/privacy/${id}.hbs`
}

/** Resolved plaintext for a built-in id (from `.hbs` under the prompts root). */
export function resolveBuiltinPolicyBody(id: BrainQueryBuiltinPolicyId): string {
  return readPromptFile(builtinPolicyHbsRel(id)).trim()
}

/** Effective privacy instructions for filter / notifications (preset from `.hbs`, custom from policy row). */
export function resolveGrantPrivacyInstructions(row: BrainQueryGrantRow): string {
  if (row.preset_policy_key != null) {
    if (!isBrainQueryBuiltinPolicyId(row.preset_policy_key)) {
      return ''
    }
    return resolveBuiltinPolicyBody(row.preset_policy_key)
  }
  if (row.custom_policy_id != null) {
    const policy = getBrainQueryCustomPolicyById(row.custom_policy_id)
    if (!policy || policy.owner_id !== row.owner_id) {
      return ''
    }
    return policy.body.trim()
  }
  return ''
}

export function toB2BGrantPolicySnapshot(row: BrainQueryGrantRow): B2BGrantPolicy {
  return {
    id: row.id,
    owner_id: row.owner_id,
    asker_id: row.asker_id,
    privacy_policy: resolveGrantPrivacyInstructions(row),
  }
}
