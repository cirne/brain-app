const raw = process.env.BRAIN_B2B_ENABLED?.trim().toLowerCase()

/**
 * Cross-workspace brain query (brain-to-brain). **Off** when `BRAIN_B2B_ENABLED` is unset or empty.
 * **On** only when the value is `1` or `true` (case-insensitive).
 */
export const B2B_ENABLED = raw === '1' || raw === 'true'
