import type { Readable } from 'node:stream'

type StdinWithRaw = Readable & { isTTY?: boolean; setRawMode?: (raw: boolean) => void }

/**
 * Restore cooked mode if something (Vite tooling, prompts, legacy deps) left stdin raw.
 * Prevents stray ^[[A at the shell after the dev Node process exits.
 */
export function restoreStdinForShell(stdin?: StdinWithRaw): void {
  const s = stdin ?? (process.stdin as StdinWithRaw)
  try {
    if (s.isTTY && typeof s.setRawMode === 'function') {
      s.setRawMode(false)
    }
  } catch {
    /* ignore */
  }
}
