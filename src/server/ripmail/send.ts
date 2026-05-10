/**
 * send() — dispatch a draft via SMTP (nodemailer) or Gmail API.
 * Mirrors ripmail/src/send/ (smtp_send.rs + gmail_api_send.rs).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import nodemailer from 'nodemailer'
import type { Draft } from './types.js'
import { loadRipmailConfig, getImapSources, loadImapPassword, loadGoogleOAuthTokens } from './sync/config.js'
import { brainLogger } from '@server/lib/observability/brainLogger.js'

export interface SendOptions {
  dryRun?: boolean
}

export interface SendResult {
  ok: boolean
  draftId: string
  dryRun: boolean
  message?: string
}

function loadDraft(ripmailHome: string, draftId: string): Draft | null {
  const p = join(ripmailHome, 'drafts', `${draftId}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Draft
  } catch {
    return null
  }
}

function getSmtpConfig(ripmailHome: string, sourceId?: string): { host: string; port: number; user: string; pass: string } | null {
  const config = loadRipmailConfig(ripmailHome)
  const sources = getImapSources(config)
  const source = sourceId
    ? sources.find((s) => s.id === sourceId || s.email === sourceId)
    : sources[0]
  if (!source?.imap) return null
  const password = loadImapPassword(ripmailHome, source.id)
  if (!password) return null
  return {
    host: source.imap.host.replace('imap.', 'smtp.'),
    port: 587,
    user: source.imap.user,
    pass: password,
  }
}

async function sendViaSmtp(
  ripmailHome: string,
  draft: Draft,
): Promise<void> {
  const smtpConfig = getSmtpConfig(ripmailHome, draft.sourceId)
  if (!smtpConfig) throw new Error('No SMTP configuration found. Check config.json and per-source .env')

  const transport = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: false,
    auth: { user: smtpConfig.user, pass: smtpConfig.pass },
  })

  await transport.sendMail({
    from: smtpConfig.user,
    to: (draft.to ?? []).join(', '),
    cc: (draft.cc ?? []).join(', ') || undefined,
    bcc: (draft.bcc ?? []).join(', ') || undefined,
    subject: draft.subject,
    text: draft.body,
  })
}

async function sendViaGmailApi(
  ripmailHome: string,
  draft: Draft,
): Promise<void> {
  const { google } = await import('googleapis')
  const config = loadRipmailConfig(ripmailHome)
  const sources = getImapSources(config)
  const source = draft.sourceId
    ? sources.find((s) => s.id === draft.sourceId || s.email === draft.sourceId)
    : sources.find((s) => s.imapAuth === 'googleOAuth')

  if (!source) throw new Error('No Gmail source found for send')
  const tokens = loadGoogleOAuthTokens(ripmailHome, source.id)
  if (!tokens) throw new Error('No OAuth tokens found for Gmail send')

  const clientId = tokens.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = tokens.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Missing OAuth client credentials')

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken })
  const gmail = google.gmail({ version: 'v1', auth: oauth2 })

  const to = (draft.to ?? []).join(', ')
  const raw = Buffer.from(
    `From: ${source.email ?? ''}\r\nTo: ${to}\r\nSubject: ${draft.subject}\r\n\r\n${draft.body}`,
  ).toString('base64url')

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

/**
 * Send a draft. Dispatches via SMTP or Gmail API depending on source config.
 */
export async function send(ripmailHome: string, draftId: string, opts?: SendOptions): Promise<SendResult> {
  const draft = loadDraft(ripmailHome, draftId)
  if (!draft) throw new Error(`Draft not found: ${draftId}`)

  if (opts?.dryRun) {
    return {
      ok: true,
      draftId,
      dryRun: true,
      message: `[dry run] Would send "${draft.subject}" to ${(draft.to ?? []).join(', ')}`,
    }
  }

  // Determine send path: Gmail API preferred for OAuth sources
  const config = loadRipmailConfig(ripmailHome)
  const sources = getImapSources(config)
  const source = draft.sourceId
    ? sources.find((s) => s.id === draft.sourceId || s.email === draft.sourceId)
    : sources[0]

  try {
    if (source?.imapAuth === 'googleOAuth') {
      await sendViaGmailApi(ripmailHome, draft)
    } else {
      await sendViaSmtp(ripmailHome, draft)
    }
    brainLogger.info({ draftId, to: draft.to }, 'ripmail:send:sent')
    return { ok: true, draftId, dryRun: false }
  } catch (e) {
    throw new Error(`Send failed: ${String(e)}`, { cause: e })
  }
}
