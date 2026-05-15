import { describe, expect, it } from 'vitest'
import { readPromptFile } from '@server/lib/prompts/render.js'
import { BRAIN_QUERY_BUILTIN_POLICY_BODIES } from '@shared/brainQueryBuiltinPolicyBodies.js'
import {
  BRAIN_QUERY_BUILTIN_POLICY_IDS,
  type BrainQueryBuiltinPolicyId,
} from '@shared/brainQueryBuiltinPolicyIds.js'

describe('brain-query privacy .hbs vs shared bodies', () => {
  it.each(BRAIN_QUERY_BUILTIN_POLICY_IDS)('%s matches shared canonical text', (id: BrainQueryBuiltinPolicyId) => {
    const fromHbs = readPromptFile(`brain-query/privacy/${id}.hbs`).trim()
    expect(fromHbs).toBe(BRAIN_QUERY_BUILTIN_POLICY_BODIES[id])
  })
})
