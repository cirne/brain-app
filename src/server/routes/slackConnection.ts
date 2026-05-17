import { Hono } from 'hono'
import {
  deleteSlackUserLink,
  getSlackWorkspace,
  isSlackOAuthConfigured,
  listSlackUserLinksForTenant,
  listSlackWorkspacesForInstaller,
  tenantHasSlackWorkspaceAccess,
} from '@server/lib/slack/slackConnectionsRepo.js'
import {
  getSlackUserSettings,
  isSlackInboundPolicyIdForTenant,
  upsertSlackUserSettings,
} from '@server/lib/slack/slackUserSettingsRepo.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'

const app = new Hono()

/** GET /api/slack/connection/:teamId/settings — per-workspace prefs for the signed-in user. */
app.get('/connection/:teamId/settings', (c) => {
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ ok: false, error: 'no_tenant' }, 401)
  }
  const teamId = c.req.param('teamId')?.trim() ?? ''
  if (!teamId) return c.json({ error: 'teamId_required' }, 400)
  if (!tenantHasSlackWorkspaceAccess(ctx.tenantUserId, teamId)) {
    return c.json({ error: 'slack_workspace_forbidden' }, 403)
  }
  const s = getSlackUserSettings({ tenantUserId: ctx.tenantUserId, slackTeamId: teamId })
  return c.json({ ok: true, ...s })
})

/** PATCH /api/slack/connection/:teamId/settings */
app.patch('/connection/:teamId/settings', async (c) => {
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ ok: false, error: 'no_tenant' }, 401)
  }
  const teamId = c.req.param('teamId')?.trim() ?? ''
  if (!teamId) return c.json({ error: 'teamId_required' }, 400)
  if (!tenantHasSlackWorkspaceAccess(ctx.tenantUserId, teamId)) {
    return c.json({ error: 'slack_workspace_forbidden' }, 403)
  }
  let body: { autorespond?: unknown; inboundPolicy?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const current = getSlackUserSettings({ tenantUserId: ctx.tenantUserId, slackTeamId: teamId })
  let autorespond = current.autorespond
  if (body.autorespond !== undefined) {
    if (typeof body.autorespond !== 'boolean') {
      return c.json({ error: 'autorespond_invalid' }, 400)
    }
    autorespond = body.autorespond
  }
  let inboundPolicy = current.inboundPolicy
  if (body.inboundPolicy !== undefined) {
    if (!isSlackInboundPolicyIdForTenant(body.inboundPolicy, ctx.tenantUserId)) {
      return c.json({ error: 'inbound_policy_invalid' }, 400)
    }
    inboundPolicy = body.inboundPolicy.trim() as typeof inboundPolicy
  }
  const saved = upsertSlackUserSettings({
    tenantUserId: ctx.tenantUserId,
    slackTeamId: teamId,
    autorespond,
    inboundPolicy,
  })
  return c.json({ ok: true, ...saved })
})

/** GET /api/slack/connection — vault-gated Slack workspace + user link status. */
app.get('/connection', (c) => {
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ ok: false, error: 'no_tenant' }, 401)
  }
  const tenantUserId = ctx.tenantUserId
  const userLinks = listSlackUserLinksForTenant(tenantUserId)
  const installed = listSlackWorkspacesForInstaller(tenantUserId)

  const workspaces = installed.map((w) => {
    const userLink = userLinks.find((l) => l.slack_team_id === w.slack_team_id)
    return {
      slackTeamId: w.slack_team_id,
      teamName: w.team_name,
      workspaceConnected: true,
      userLinked: userLink != null,
      slackUserId: userLink?.slack_user_id ?? null,
    }
  })

  for (const link of userLinks) {
    if (workspaces.some((w) => w.slackTeamId === link.slack_team_id)) continue
    const w = getSlackWorkspace(link.slack_team_id)
    workspaces.push({
      slackTeamId: link.slack_team_id,
      teamName: w?.team_name ?? link.slack_team_id,
      workspaceConnected: w != null,
      userLinked: true,
      slackUserId: link.slack_user_id,
    })
  }

  return c.json({
    ok: true,
    oauthConfigured: isSlackOAuthConfigured(),
    workspaces,
  })
})

/** DELETE /api/slack/link — remove the user's Slack account link for a given workspace. */
app.delete('/link', async (c) => {
  const ctx = tryGetTenantContext()
  if (!ctx) {
    return c.json({ ok: false, error: 'no_tenant' }, 401)
  }
  let body: { slackTeamId?: unknown }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid_json' }, 400)
  }
  const slackTeamId = typeof body.slackTeamId === 'string' ? body.slackTeamId.trim() : ''
  if (!slackTeamId) return c.json({ error: 'slackTeamId_required' }, 400)
  deleteSlackUserLink({ slackTeamId, tenantUserId: ctx.tenantUserId })
  return c.json({ ok: true })
})

export default app
