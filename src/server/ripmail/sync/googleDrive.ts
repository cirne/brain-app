/**
 * Google Drive folder listing for Hub folder picker.
 */

import process from 'node:process'
import { google } from 'googleapis'
import type { GoogleOAuthTokens, SourceConfig } from './config.js'
import { loadGoogleOAuthTokens } from './config.js'
import type { HubBrowseFolderRow } from '../../lib/hub/hubRipmailSources.js'

function buildOAuthClient(tokens: GoogleOAuthTokens) {
  const clientId = tokens.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = tokens.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  return oauth2
}

function oauthSourceId(source: SourceConfig): string {
  return source.oauthSourceId?.trim() || source.id
}

/**
 * List folders in Google Drive.
 * If parentId is 'root' or undefined, lists top-level folders.
 */
export async function listGoogleDriveFolders(
  ripmailHome: string,
  source: SourceConfig,
  parentId?: string,
): Promise<HubBrowseFolderRow[]> {
  const tokens = loadGoogleOAuthTokens(ripmailHome, oauthSourceId(source))
  const auth = tokens ? buildOAuthClient(tokens) : null
  if (!auth) return []

  const drive = google.drive({ version: 'v3', auth })
  const q = [
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(' and ')

  const folders: HubBrowseFolderRow[] = []
  let pageToken: string | undefined

  try {
    do {
      const res = await drive.files.list({
        q,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 100,
        pageToken,
      })

      for (const f of res.data.files ?? []) {
        if (f.id && f.name) {
          folders.push({
            id: f.id,
            name: f.name,
            hasChildren: true, // Assume folders might have subfolders to avoid extra API calls
          })
        }
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (e) {
    console.error('[googleDrive] list folders failed:', e)
    return []
  }

  return folders.sort((a, b) => a.name.localeCompare(b.name))
}
