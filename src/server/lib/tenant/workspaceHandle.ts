/** Min/max length after normalization (lowercase slug). */
export const WORKSPACE_HANDLE_MIN_LEN = 3
export const WORKSPACE_HANDLE_MAX_LEN = 32

const RESERVED = new Set([
  '.global',
  '_single',
  'lost+found',
  'lost found',
])

/** Starts with letter/number; hyphens allowed inside; 3–32 chars. */
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

export class InvalidWorkspaceHandleError extends Error {
  readonly code = 'invalid_workspace_handle'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidWorkspaceHandleError'
  }
}

/** Trim + lowercase (filesystem-safe directory name). */
export function normalizeWorkspaceHandle(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isReservedWorkspaceHandle(normalized: string): boolean {
  return RESERVED.has(normalized)
}

/**
 * Validates and returns normalized handle. Throws {@link InvalidWorkspaceHandleError}.
 */
export function parseWorkspaceHandle(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new InvalidWorkspaceHandleError('Workspace name is required.')
  }
  const h = normalizeWorkspaceHandle(raw)
  if (h.length < WORKSPACE_HANDLE_MIN_LEN || h.length > WORKSPACE_HANDLE_MAX_LEN) {
    throw new InvalidWorkspaceHandleError(
      `Workspace name must be ${WORKSPACE_HANDLE_MIN_LEN}–${WORKSPACE_HANDLE_MAX_LEN} characters.`,
    )
  }
  if (!HANDLE_PATTERN.test(h)) {
    throw new InvalidWorkspaceHandleError(
      'Use lowercase letters, numbers, and hyphens only. Start and end with a letter or number.',
    )
  }
  if (isReservedWorkspaceHandle(h)) {
    throw new InvalidWorkspaceHandleError('That workspace name is reserved.')
  }
  return h
}
