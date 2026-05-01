/**
 * Path to the ripmail CLI for subprocess calls. Prefer `RIPMAIL_BIN` when set (e.g. dev spawn).
 */
export function ripmailBin(): string {
  const fromEnv = process.env.RIPMAIL_BIN?.trim()
  if (fromEnv) return fromEnv
  return 'ripmail'
}
