/**
 * Load ripmail config.json from a ripmail home directory.
 * Mirrors ripmail/src/config.rs ConfigJson.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ImapConfig {
  host: string
  port: number
  user: string
}

export interface SourceConfig {
  id: string
  kind: 'imap' | 'applemail' | 'localDir' | 'googleCalendar' | 'appleCalendar' | 'icsSubscription' | 'icsFile' | 'googleDrive'
  email?: string
  imap?: ImapConfig
  imapAuth?: 'appPassword' | 'googleOAuth'
  label?: string
  includeInDefault?: boolean
  /** Google Calendar source: selected calendar IDs (Hub / config.json). */
  calendarIds?: string[]
  defaultCalendars?: string[]
  icsUrl?: string
  includeSharedWithMe?: boolean
  oauthSourceId?: string
  fileSource?: {
    roots?: Array<{ id: string; name?: string; recursive?: boolean }>
    includeGlobs?: string[]
    ignoreGlobs?: string[]
    maxFileBytes?: number
    respectGitignore?: boolean
  }
}

export interface RipmailConfig {
  sources?: SourceConfig[]
  /** Legacy single-mailbox IMAP config. */
  imap?: ImapConfig & { user?: string; email?: string; imapAuth?: string }
  sync?: {
    defaultSince?: string
    mailbox?: string
    excludeLabels?: string[]
  }
  attachments?: { cacheExtractedText?: boolean }
  inbox?: { defaultWindow?: string }
}

export function loadRipmailConfig(ripmailHome: string): RipmailConfig {
  const path = join(ripmailHome, 'config.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as RipmailConfig
  } catch {
    return {}
  }
}

export function getImapSources(config: RipmailConfig): SourceConfig[] {
  const sources = config.sources ?? []
  return sources.filter((s) => s.kind === 'imap' || !s.kind)
}

export function getGoogleCalendarSources(config: RipmailConfig): SourceConfig[] {
  const sources = config.sources ?? []
  return sources.filter((s) => s.kind === 'googleCalendar')
}

/** Google Calendar sources store OAuth tokens under the owning Gmail source. */
export function googleOAuthTokenSourceId(source: SourceConfig): string {
  return source.oauthSourceId?.trim() || source.id
}

/** Read the IMAP password for a source from per-source .env. */
export function loadImapPassword(ripmailHome: string, sourceId: string): string | undefined {
  const envPath = join(ripmailHome, sourceId, '.env')
  if (!existsSync(envPath)) {
    // Try root .env
    const rootEnv = join(ripmailHome, '.env')
    if (!existsSync(rootEnv)) return undefined
    const content = readFileSync(rootEnv, 'utf8')
    return parseEnvValue(content, 'RIPMAIL_IMAP_PASSWORD')
  }
  const content = readFileSync(envPath, 'utf8')
  return parseEnvValue(content, 'RIPMAIL_IMAP_PASSWORD')
}

function parseEnvValue(content: string, key: string): string | undefined {
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(key + '=')) continue
    let value = trimmed.slice(key.length + 1)
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1)
    return value
  }
  return undefined
}

/** Save updated config back to disk. */
export function saveRipmailConfig(ripmailHome: string, config: RipmailConfig): void {
  const path = join(ripmailHome, 'config.json')
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8')
}

/** Load Google OAuth tokens for a source. */
export interface GoogleOAuthTokens {
  accessToken?: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
}

export function loadGoogleOAuthTokens(ripmailHome: string, sourceId: string): GoogleOAuthTokens | null {
  const path = join(ripmailHome, sourceId, 'google-oauth.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as GoogleOAuthTokens
  } catch {
    return null
  }
}

/** Google OAuth refresh returns `invalid_grant` when the refresh token is revoked or expired. */
export function errorMessageIndicatesInvalidGoogleGrant(message: string): boolean {
  return /\binvalid_grant\b/i.test(message)
}

/**
 * Remove stored OAuth tokens for a mailbox source (ripmail `{sourceId}/google-oauth.json`).
 * Returns whether the file existed and was removed.
 */
export function removeGoogleOAuthTokenFile(ripmailHome: string, sourceId: string): boolean {
  const path = join(ripmailHome, sourceId, 'google-oauth.json')
  if (!existsSync(path)) return false
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}
