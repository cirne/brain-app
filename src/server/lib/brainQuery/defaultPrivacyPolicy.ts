import { resolveBuiltinPolicyBody } from '@server/lib/brainQuery/resolveGrantPrivacyInstructions.js'

/** Legacy name: same text as built-in id `server-default` (see `brain-query/privacy/server-default.hbs`). */
export const DEFAULT_BRAIN_QUERY_PRIVACY_POLICY = resolveBuiltinPolicyBody('server-default')
