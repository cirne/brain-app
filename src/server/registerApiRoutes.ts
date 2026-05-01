import type { Hono } from 'hono'
import chatRoute from './routes/chat.js'
import skillsRoute from './routes/skills.js'
import wikiRoute from './routes/wiki.js'
import filesRoute from './routes/files.js'
import inboxRoute from './routes/inbox.js'
import calendarRoute from './routes/calendar.js'
import searchRoute from './routes/search.js'
import imessageRoute from './routes/imessage.js'
import onboardingRoute from './routes/onboarding.js'
import backgroundRoute from './routes/background.js'
import yourWikiRoute from './routes/yourWiki.js'
import gmailOAuthRoute from './routes/gmailOAuth.js'
import demoEnronAuthRoute from './routes/demoEnronAuth.js'
import navRecentsRoute from './routes/navRecents.js'
import oauthGoogleBrowserPages from './routes/oauthGoogleBrowserPages.js'
import issuesRoute from './routes/issues.js'
import hubRoute from './routes/hub.js'
import hubEventsRoute from './routes/hubEvents.js'
import vaultRoute from './routes/vault.js'
import accountRoute from './routes/account.js'
import transcribeRoute from './routes/transcribe.js'
import devicesRoute from './routes/devices.js'
import ingestRoute from './routes/ingest.js'
import debugRipmailChildrenRoute from './routes/debugRipmailChildren.js'

/** Mount all API (and related) routes on the main Hono app — single place for `app.route` prefixes. */
export function registerApiRoutes(app: Hono, options: { isDev: boolean }): void {
  const { isDev } = options
  app.route('/api/vault', vaultRoute)
  app.route('/api/account', accountRoute)
  app.route('/api/chat', chatRoute)
  app.route('/api/transcribe', transcribeRoute)
  app.route('/api/devices', devicesRoute)
  app.route('/api/ingest', ingestRoute)
  app.route('/api/skills', skillsRoute)
  app.route('/api/issues', issuesRoute)
  app.route('/api/wiki', wikiRoute)
  app.route('/api/files', filesRoute)
  app.route('/api/inbox', inboxRoute)
  app.route('/api/calendar', calendarRoute)
  app.route('/api/search', searchRoute)
  app.route('/api/imessage', imessageRoute)
  app.route('/api/messages', imessageRoute)
  app.route('/api/onboarding', onboardingRoute)
  app.route('/api/hub', hubRoute)
  app.route('/api/events', hubEventsRoute)
  app.route('/api/background', backgroundRoute)
  app.route('/api/your-wiki', yourWikiRoute)
  app.route('/api/oauth/google', gmailOAuthRoute)
  app.route('/api/auth/demo', demoEnronAuthRoute)
  app.route('/api/nav/recents', navRecentsRoute)
  app.route('/oauth/google', oauthGoogleBrowserPages)
  if (isDev || process.env.BRAIN_DEBUG_CHILDREN === '1') {
    app.route('/api/debug', debugRipmailChildrenRoute)
  }
}
