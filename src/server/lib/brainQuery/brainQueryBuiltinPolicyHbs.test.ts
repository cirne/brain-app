import { describe, expect, it } from 'vitest'
import { readPromptFile } from '@server/lib/prompts/render.js'
import { getBuiltinPolicyBodiesFromDisk } from '@server/lib/brainQuery/builtinPolicyBodiesFromDisk.js'
import {
  BRAIN_QUERY_BUILTIN_POLICY_IDS,
  type BrainQueryBuiltinPolicyId,
} from '@shared/brainQueryBuiltinPolicyIds.js'

describe('brain-query privacy .hbs vs getBuiltinPolicyBodiesFromDisk', () => {
  it.each(BRAIN_QUERY_BUILTIN_POLICY_IDS)('%s matches on-disk prompt', (id: BrainQueryBuiltinPolicyId) => {
    const fromHbs = readPromptFile(`brain-query/privacy/${id}.hbs`).trim()
    expect(getBuiltinPolicyBodiesFromDisk()[id]).toBe(fromHbs)
  })
})
