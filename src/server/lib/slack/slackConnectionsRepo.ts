import { getBrainGlobalDb } from '@server/lib/global/brainGlobalDb.js'

export type SlackWorkspaceRow = {
  slack_team_id: string
  team_name: string
  installer_tenant_user_id: string
  bot_token: string
  installed_at_ms: number
}

export type SlackUserLinkRow = {
  slack_team_id: string
  slack_user_id: string
  tenant_user_id: string
  slack_email: string | null
  linked_at_ms: number
}

function workspaceFromRow(r: unknown): SlackWorkspaceRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (
    typeof o.slack_team_id !== 'string' ||
    typeof o.team_name !== 'string' ||
    typeof o.installer_tenant_user_id !== 'string' ||
    typeof o.bot_token !== 'string' ||
    typeof o.installed_at_ms !== 'number'
  ) {
    return null
  }
  return {
    slack_team_id: o.slack_team_id,
    team_name: o.team_name,
    installer_tenant_user_id: o.installer_tenant_user_id,
    bot_token: o.bot_token,
    installed_at_ms: o.installed_at_ms,
  }
}

function linkFromRow(r: unknown): SlackUserLinkRow | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (
    typeof o.slack_team_id !== 'string' ||
    typeof o.slack_user_id !== 'string' ||
    typeof o.tenant_user_id !== 'string' ||
    typeof o.linked_at_ms !== 'number'
  ) {
    return null
  }
  const email = o.slack_email
  return {
    slack_team_id: o.slack_team_id,
    slack_user_id: o.slack_user_id,
    tenant_user_id: o.tenant_user_id,
    slack_email: typeof email === 'string' && email.trim() ? email.trim() : null,
    linked_at_ms: o.linked_at_ms,
  }
}

export function upsertSlackWorkspace(params: {
  slackTeamId: string
  teamName: string
  installerTenantUserId: string
  botToken: string
}): SlackWorkspaceRow {
  const now = Date.now()
  const db = getBrainGlobalDb()
  db.prepare(
    `INSERT INTO slack_workspaces (slack_team_id, team_name, installer_tenant_user_id, bot_token, installed_at_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(slack_team_id) DO UPDATE SET
       team_name = excluded.team_name,
       installer_tenant_user_id = excluded.installer_tenant_user_id,
       bot_token = excluded.bot_token`,
  ).run(
    params.slackTeamId,
    params.teamName,
    params.installerTenantUserId,
    params.botToken,
    getSlackWorkspace(params.slackTeamId)?.installed_at_ms ?? now,
  )
  return getSlackWorkspace(params.slackTeamId)!
}

export function getSlackWorkspace(slackTeamId: string): SlackWorkspaceRow | null {
  const r = getBrainGlobalDb()
    .prepare(`SELECT * FROM slack_workspaces WHERE slack_team_id = ?`)
    .get(slackTeamId)
  return workspaceFromRow(r)
}

export function listSlackWorkspacesForInstaller(tenantUserId: string): SlackWorkspaceRow[] {
  const rows = getBrainGlobalDb()
    .prepare(
      `SELECT * FROM slack_workspaces WHERE installer_tenant_user_id = ? ORDER BY installed_at_ms DESC`,
    )
    .all(tenantUserId) as unknown[]
  return rows.map(workspaceFromRow).filter((r): r is SlackWorkspaceRow => r != null)
}

export function upsertSlackUserLink(params: {
  slackTeamId: string
  slackUserId: string
  tenantUserId: string
  slackEmail?: string | null
}): SlackUserLinkRow {
  const now = Date.now()
  const email =
    params.slackEmail != null && String(params.slackEmail).trim()
      ? String(params.slackEmail).trim()
      : null
  getBrainGlobalDb()
    .prepare(
      `INSERT INTO slack_user_links (slack_team_id, slack_user_id, tenant_user_id, slack_email, linked_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(slack_team_id, slack_user_id) DO UPDATE SET
         tenant_user_id = excluded.tenant_user_id,
         slack_email = excluded.slack_email,
         linked_at_ms = excluded.linked_at_ms`,
    )
    .run(params.slackTeamId, params.slackUserId, params.tenantUserId, email, now)
  return resolveLinkedTenant(params.slackTeamId, params.slackUserId)!
}

export function resolveLinkedTenant(
  slackTeamId: string,
  slackUserId: string,
): SlackUserLinkRow | null {
  const r = getBrainGlobalDb()
    .prepare(
      `SELECT * FROM slack_user_links WHERE slack_team_id = ? AND slack_user_id = ?`,
    )
    .get(slackTeamId, slackUserId)
  return linkFromRow(r)
}

export function listLinkedUsersInWorkspace(slackTeamId: string): SlackUserLinkRow[] {
  const rows = getBrainGlobalDb()
    .prepare(
      `SELECT * FROM slack_user_links WHERE slack_team_id = ? ORDER BY linked_at_ms ASC`,
    )
    .all(slackTeamId) as unknown[]
  return rows.map(linkFromRow).filter((r): r is SlackUserLinkRow => r != null)
}

export function listSlackUserLinksForTenant(tenantUserId: string): SlackUserLinkRow[] {
  const rows = getBrainGlobalDb()
    .prepare(
      `SELECT * FROM slack_user_links WHERE tenant_user_id = ? ORDER BY linked_at_ms DESC`,
    )
    .all(tenantUserId) as unknown[]
  return rows.map(linkFromRow).filter((r): r is SlackUserLinkRow => r != null)
}

/** Bot token from workspace install, else env fallback for dev hello-world. */
export function getWorkspaceBotToken(slackTeamId: string): string | null {
  const row = getSlackWorkspace(slackTeamId)
  if (row?.bot_token?.trim()) return row.bot_token.trim()
  const env = process.env.SLACK_BOT_TOKEN?.trim()
  return env && env.length > 0 ? env : null
}

export function isSlackOAuthConfigured(): boolean {
  const id = process.env.SLACK_CLIENT_ID?.trim()
  const secret = process.env.SLACK_CLIENT_SECRET?.trim()
  return Boolean(id && secret)
}
