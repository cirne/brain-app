'use strict'

/**
 * New Relic Node agent config. Secrets stay in the environment; everything
 * else lives here so Docker and local runs behave the same.
 *
 * Required env (when you want the agent on):
 *   NEW_RELIC_LICENSE_KEY — ingest license key (not the NRAK user API key)
 * Optional env:
 *   NEW_RELIC_APP_NAME — defaults below
 *
 * Precedence (per NR docs): server-side config > environment variables >
 * this file > agent defaults. Docker copies this file to /app/newrelic.cjs.
 */
const licenseKey = process.env.NEW_RELIC_LICENSE_KEY || ''

exports.config = {
  agent_enabled: Boolean(licenseKey),
  app_name: [process.env.NEW_RELIC_APP_NAME || 'Braintunnel Local Dev'],
  license_key: licenseKey,

  /** Agent diagnostics (not application logs); stdout suits containers. */
  logging: {
    filepath: 'stdout',
    level: 'info',
  },

  distributed_tracing: {
    enabled: true,
  },

  ai_monitoring: {
    enabled: true,
  },

  /** Tunables previously set via Dockerfile ENV */
  custom_insights_events: {
    max_samples_stored: 100000,
  },
  span_events: {
    max_samples_stored: 10000,
  },

  application_logging: {
    enabled: true,
    forwarding: { enabled: true, max_samples_stored: 10000 },
    local_decorating: { enabled: false },
    metrics: { enabled: true },
  },
}
