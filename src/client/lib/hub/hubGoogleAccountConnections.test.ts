import { describe, expect, it } from 'vitest'
import type { HubRipmailSourceRow } from '@client/lib/hub/hubRipmailSource.js'
import {
  buildSettingsConnectionListEntries,
  googleAccountClusterKey,
  sourcesForGoogleAccountPanel,
} from '@client/lib/hub/hubGoogleAccountConnections.js'

function row(partial: Partial<HubRipmailSourceRow> & Pick<HubRipmailSourceRow, 'id' | 'kind' | 'displayName'>): HubRipmailSourceRow {
  return { path: null, ...partial }
}

describe('hubGoogleAccountConnections', () => {
  it('clusters Gmail + Calendar + Drive on shared oauthSourceId', () => {
    const sources: HubRipmailSourceRow[] = [
      row({
        id: 'm1',
        kind: 'imap',
        displayName: 'u@x.com',
        oauthSourceId: 'go',
        email: 'u@x.com',
      }),
      row({
        id: 'c1',
        kind: 'googleCalendar',
        displayName: 'u@x.com',
        oauthSourceId: 'go',
        email: 'u@x.com',
      }),
      row({
        id: 'd1',
        kind: 'googleDrive',
        displayName: 'u@x.com',
        oauthSourceId: 'go',
        email: 'u@x.com',
      }),
    ]
    const ga = buildSettingsConnectionListEntries(sources).filter(
      (e): e is Extract<typeof e, { type: 'google-account' }> => e.type === 'google-account',
    )
    expect(ga).toHaveLength(1)
    expect(ga[0].sources).toHaveLength(3)
  })

  it('keeps non-OAuth IMAP out of Google bundle', () => {
    const sources: HubRipmailSourceRow[] = [
      row({ id: 'legacy', kind: 'imap', displayName: 'old@imap.com' }),
      row({
        id: 'c1',
        kind: 'googleCalendar',
        displayName: 'new@x.com',
        oauthSourceId: 'o2',
        email: 'new@x.com',
      }),
    ]
    expect(googleAccountClusterKey(sources[0])).toBeNull()
    const entries = buildSettingsConnectionListEntries(sources)
    expect(entries.some((e) => e.type === 'single' && e.source.id === 'legacy')).toBe(true)
    expect(entries.some((e) => e.type === 'google-account')).toBe(true)
  })

  it('clusters imap+cal+drive when imap has email but no oauthSourceId (real ripmail config shape)', () => {
    const sources: HubRipmailSourceRow[] = [
      row({ id: 'lewiscirne_gmail_com', kind: 'imap', displayName: 'lewiscirne@gmail.com', email: 'lewiscirne@gmail.com' }),
      row({ id: 'lewiscirne_gmail_com-gcal', kind: 'googleCalendar', displayName: 'lewiscirne@gmail.com', oauthSourceId: 'lewiscirne_gmail_com', email: 'lewiscirne@gmail.com' }),
      row({ id: 'lewiscirne_gmail_com-drive', kind: 'googleDrive', displayName: 'lewiscirne@gmail.com', oauthSourceId: 'lewiscirne_gmail_com', email: 'lewiscirne@gmail.com' }),
    ]
    const ga = buildSettingsConnectionListEntries(sources).filter(
      (e): e is Extract<typeof e, { type: 'google-account' }> => e.type === 'google-account',
    )
    expect(ga).toHaveLength(1)
    expect(ga[0].sources).toHaveLength(3)
    expect(ga[0].panelEmail).toBe('lewiscirne@gmail.com')
  })

  it('produces two rows for two Google accounts without server enrichment (old server compat)', () => {
    // Old server returns no oauthSourceId/email — just displayName (which sourceDisplayName sets to email).
    // imap sources have no OAuth markers → standalone; cal+drive cluster by displayName (the email).
    const sources: HubRipmailSourceRow[] = [
      row({ id: 'lewiscirne_gmail_com', kind: 'imap', displayName: 'lewiscirne@gmail.com' }),
      row({ id: 'lewiscirne_gmail_com-gcal', kind: 'googleCalendar', displayName: 'lewiscirne@gmail.com' }),
      row({ id: 'lewiscirne_gmail_com-drive', kind: 'googleDrive', displayName: 'lewiscirne@gmail.com' }),
      row({ id: 'cirne_gamaliel_ai', kind: 'imap', displayName: 'cirne@gamaliel.ai' }),
      row({ id: 'cirne_gamaliel_ai-gcal', kind: 'googleCalendar', displayName: 'cirne@gamaliel.ai' }),
      row({ id: 'cirne_gamaliel_ai-drive', kind: 'googleDrive', displayName: 'cirne@gamaliel.ai' }),
    ]
    const entries = buildSettingsConnectionListEntries(sources)
    expect(entries.filter((e) => e.type === 'single')).toHaveLength(2)
    expect(entries.filter((e) => e.type === 'google-account')).toHaveLength(2)
  })

  it('sourcesForGoogleAccountPanel expands by oauth after email seed', () => {
    const sources: HubRipmailSourceRow[] = [
      row({
        id: 'm1',
        kind: 'imap',
        displayName: 'User',
        oauthSourceId: 'oid',
        email: 'real@x.com',
      }),
      row({
        id: 'd1',
        kind: 'googleDrive',
        displayName: 'User',
        oauthSourceId: 'oid',
        email: 'real@x.com',
      }),
    ]
    const panel = sourcesForGoogleAccountPanel(sources, 'real@x.com')
    expect(panel.map((s) => s.id).sort()).toEqual(['d1', 'm1'])
  })
})
