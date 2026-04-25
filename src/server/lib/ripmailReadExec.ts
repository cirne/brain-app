/**
 * Shared `exec` options for `ripmail read` stdout (JSON or text).
 * Node's default maxBuffer is 1 MiB — large emails, PDF extraction JSON, etc. exceed that.
 *
 * Used by: agent `read_email`, GET /api/files/read, GET /api/inbox/:id (`ripmail read --json --full-body` + `bodyHtml` when present; `--full-body` turns off 500k-char cap on `read <path>` local files).
 */
export const RIPMAIL_READ_MAX_BUFFER_BYTES = 20 * 1024 * 1024

/** Large PDFs / slow disks */
export const RIPMAIL_READ_TIMEOUT_MS = 120_000

export function ripmailReadExecOptions(): {
  timeout: number
  maxBuffer: number
} {
  return {
    timeout: RIPMAIL_READ_TIMEOUT_MS,
    maxBuffer: RIPMAIL_READ_MAX_BUFFER_BYTES,
  }
}
