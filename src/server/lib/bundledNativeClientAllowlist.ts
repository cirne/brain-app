/**
 * When the server runs as the bundled native app (`BRAIN_BUNDLED_NATIVE=1`), HTTP clients must be
 * either local (loopback) or Tailscale mesh peers (RFC 6598 Shared Address Space 100.64.0.0/10).
 * This blocks arbitrary LAN clients (e.g. 192.168.x.x) from the same listen socket
 * while allowing Tailscale and the embedded WebView / OAuth on 127.0.0.1.
 */

const CGNAT_FIRST = 100
const CGNAT_SECOND_MIN = 64
const CGNAT_SECOND_MAX = 127

/** Strip Node's IPv4-mapped IPv6 form (::ffff:a.b.c.d) to dotted IPv4. */
function normalizeRemoteAddress(addr: string): string {
  const lower = addr.toLowerCase()
  if (lower.startsWith('::ffff:')) return lower.slice('::ffff:'.length)
  return addr
}

function isIpv4Loopback(parts: number[]): boolean {
  return parts.length === 4 && parts[0] === 127
}

function isInCgnat100_64Range(parts: number[]): boolean {
  if (parts.length !== 4) return false
  const [a, b] = parts
  if (a !== CGNAT_FIRST) return false
  return b >= CGNAT_SECOND_MIN && b <= CGNAT_SECOND_MAX
}

function parseIpv4Dotted(s: string): number[] | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map((p) => parseInt(p, 10))
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
  return nums
}

/**
 * Returns true if the TCP remote address is allowed to use the bundled native HTTP server.
 */
export function isAllowedBundledNativeClientIp(remoteAddress: string | undefined): boolean {
  if (remoteAddress === undefined || remoteAddress === '') return false

  const normalized = normalizeRemoteAddress(remoteAddress)

  if (normalized === '::1') return true

  const v4 = parseIpv4Dotted(normalized)
  if (v4) {
    return isIpv4Loopback(v4) || isInCgnat100_64Range(v4)
  }

  return false
}
