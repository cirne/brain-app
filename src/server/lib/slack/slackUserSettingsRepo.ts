import { isBrainQueryGrantPresetId, type BrainQueryGrantPresetId } from '@shared/brainQueryBuiltinPolicyIds.js'
import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'
import { getBrainQueryCustomPolicyById } from '@server/lib/brainQuery/brainQueryCustomPoliciesRepo.js'

export type SlackInboundPolicyId = BrainQueryGrantPresetId | `bqc_${string}`

export type SlackUserSettings = {
  autorespond: boolean
  inboundPolicy: SlackInboundPolicyId
}

export const DEFAULT_SLACK_INBOUND_POLICY: SlackInboundPolicyId = 'general'

export const DEFAULT_SLACK_USER_SETTINGS: SlackUserSettings = {
  autorespond: false,
  inboundPolicy: DEFAULT_SLACK_INBOUND_POLICY,
}

const LEGACY_INBOUND_POLICY_MAP: Record<string, SlackInboundPolicyId> = {
  'always-review': 'general',
  'auto-send': 'general',
}

export function normalizeSlackInboundPolicyId(raw: string | null | undefined): SlackInboundPolicyId {
  const v = raw?.trim() ?? ''
  if (LEGACY_INBOUND_POLICY_MAP[v]) return LEGACY_INBOUND_POLICY_MAP[v]
  if (isBrainQueryGrantPresetId(v)) return v
  if (v.startsWith('bqc_')) return v as SlackInboundPolicyId
  return DEFAULT_SLACK_INBOUND_POLICY
}

export function isSlackInboundPolicyIdForTenant(
  policyId: unknown,
  tenantUserId: string,
): policyId is SlackInboundPolicyId {
  if (typeof policyId !== 'string') return false
  const v = policyId.trim()
  if (isBrainQueryGrantPresetId(v)) return true
  if (!v.startsWith('bqc_')) return false
  const row = getBrainQueryCustomPolicyById(v)
  return row != null && row.owner_id === tenantUserId
}

export function getSlackUserSettings(params: {
  tenantUserId: string
  slackTeamId: string
}): SlackUserSettings {
  const r = getBrainGlobalDb()
    .prepare(
      `SELECT autorespond, inbound_policy FROM slack_user_settings WHERE tenant_user_id = ? AND slack_team_id = ?`,
    )
    .get(params.tenantUserId, params.slackTeamId) as {
    autorespond: number | null
    inbound_policy: string | null
  } | undefined
  if (!r) return { ...DEFAULT_SLACK_USER_SETTINGS }
  return {
    autorespond: r.autorespond === 1,
    inboundPolicy: normalizeSlackInboundPolicyId(r.inbound_policy),
  }
}

export function upsertSlackUserSettings(params: {
  tenantUserId: string
  slackTeamId: string
  autorespond: boolean
  inboundPolicy: SlackInboundPolicyId
}): SlackUserSettings {
  const now = Date.now()
  const ar = params.autorespond ? 1 : 0
  getBrainGlobalDb()
    .prepare(
      `INSERT INTO slack_user_settings (tenant_user_id, slack_team_id, autorespond, inbound_policy, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tenant_user_id, slack_team_id) DO UPDATE SET
         autorespond = excluded.autorespond,
         inbound_policy = excluded.inbound_policy,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(params.tenantUserId, params.slackTeamId, ar, params.inboundPolicy, now)

  return {
    autorespond: params.autorespond,
    inboundPolicy: params.inboundPolicy,
  }
}
