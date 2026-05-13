/**
 * Short tunnel peer label for UI: workspace handle as an @mention (Braintunnel's stable username).
 * Falls back to display name only when handle is missing.
 */
export function formatTunnelPeerMention(
  handle: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const raw = handle?.trim()
  if (raw) {
    const base = raw.startsWith('@') ? raw.slice(1).trim() : raw
    if (base.length === 0) return ''
    return `@${base}`
  }
  const name = displayName?.trim()
  if (name) return name
  return ''
}

/**
 * Close-tunnel / confirm copy: **Display Name @handle** when both exist; otherwise `@handle` or display name alone.
 */
export function formatTunnelPeerCloseDialogLabel(
  handle: string | null | undefined,
  displayName: string | null | undefined,
): string {
  const name = displayName?.trim() ?? ''
  const raw = handle?.trim() ?? ''
  const base = raw.startsWith('@') ? raw.slice(1).trim() : raw
  if (name && base) return `${name} @${base}`
  if (base) return `@${base}`
  if (name) return name
  return ''
}
