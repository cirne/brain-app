/**
 * Phone and chat_identifier handling for local Messages DB (E.164 in chat.chat_identifier).
 */

/**
 * If `s` looks like a phone number, return the significant digits (strip +, country code 1 for US).
 * Returns null if `s` doesn't look like a phone number (< 7 digits or has too many alpha chars).
 */
export function normalizePhoneDigits(s: string): string | null {
  const stripped = s.replace(/[\s\-().+]/g, '')
  if (/[a-zA-Z]{2,}/.test(stripped)) return null
  const digits = stripped.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

/**
 * Build a grep -E regex that matches a digit sequence with arbitrary non-digit separators.
 * e.g. "6502485571" → "6[^0-9]*5[^0-9]*0[^0-9]*2[^0-9]*4[^0-9]*8[^0-9]*5[^0-9]*5[^0-9]*7[^0-9]*1"
 */
export function phoneToFlexibleGrepPattern(digits: string): string {
  return digits.split('').join('[^0-9]*')
}

/**
 * Normalize user or wiki input to the form stored in chat.db for phones (E.164),
 * lowercase email, or pass through group / opaque ids.
 */
export function canonicalizeImessageChatIdentifier(input: string): string {
  const s = String(input).trim()
  if (!s) return s
  if (s.includes('@')) return s.toLowerCase()
  const digits = normalizePhoneDigits(s)
  if (digits == null) return s
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+1${digits.slice(1)}`
  return `+${digits}`
}

/** US +1 E.164 → (NXX) NXX-XXXX; other values unchanged. */
export function formatPhoneForDisplay(e164: string): string {
  const m = /^\+1(\d{10})$/.exec(e164.trim())
  if (m) {
    const d = m[1]
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  return e164.trim()
}

/**
 * Human-friendly chat_identifier for tool JSON: pretty US phones, lowercase emails, else as-is.
 */
export function formatChatIdentifierForDisplay(chatIdentifier: string | null): string {
  if (chatIdentifier == null || chatIdentifier === '') return ''
  const s = chatIdentifier.trim()
  if (s.includes('@')) return s.toLowerCase()
  if (normalizePhoneDigits(s) != null) {
    const canon = canonicalizeImessageChatIdentifier(s)
    return formatPhoneForDisplay(canon)
  }
  return s
}

/** Prefer Messages `display_name` (contact or group title); otherwise formatted chat_identifier. */
export function formatThreadChatDisplay(
  chatIdentifier: string,
  displayName: string | null | undefined,
): string {
  const d = displayName?.trim()
  if (d) return d
  return formatChatIdentifierForDisplay(chatIdentifier)
}
