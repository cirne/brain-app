/** Budgets for long-running mail operations (refresh, send). */

export const RIPMAIL_REFRESH_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const RIPMAIL_BACKFILL_TIMEOUT_MS = RIPMAIL_REFRESH_TIMEOUT_MS

/** Outbound SMTP / Gmail send — cap stuck TCP/TLS. */
export const RIPMAIL_SEND_TIMEOUT_MS = 30_000
