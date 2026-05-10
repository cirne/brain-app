/**
 * Load ripmail config.json from a ripmail home directory.
 * Mirrors ripmail/src/config.rs ConfigJson.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  fileSource?: {
    roots?: Array<{ id: string }>
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
