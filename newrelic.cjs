'use strict'

/**
 * New Relic Node agent baseline config. Loaded before application code.
 * Without NEW_RELIC_LICENSE_KEY the agent stays off so local dev does not
 * require APM env vars or print a bootstrap error stack.
 *
 * Docker runtime uses NEW_RELIC_NO_CONFIG_FILE=true (see Dockerfile) and
 * relies on environment variables instead of this file.
 */
const licenseKey = process.env.NEW_RELIC_LICENSE_KEY || ''

exports.config = {
  agent_enabled: Boolean(licenseKey),
  app_name: [process.env.NEW_RELIC_APP_NAME || 'Braintunnel Local Dev'],
  license_key: licenseKey,
  application_logging: {
    enabled: true,
    forwarding: { enabled: true, max_samples_stored: 10000 },
    local_decorating: { enabled: false },
    metrics: { enabled: true },
  },
}
