import { Hono } from 'hono'
import {
  getSlackWorkspace,
  isSlackOAuthConfigured,
  listSlackUserLinksForTenant,
  listSlackWorkspacesForInstaller,
} from '@server/lib/slack/slackConnectionsRepo.js'
import { tryGetTenantContext } from '@server/lib/tenant/tenantContext.js'

const app = new Hono()

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

export default app
