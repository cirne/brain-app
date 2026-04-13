/** Best-effort stringify for child_process exec failures (includes stderr when present). */
export function formatExecError(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const err = e as { message?: string; stderr?: string; stdout?: string }
    const tail = [err.stderr, err.stdout].filter(s => typeof s === 'string' && s.trim()).join('\n')
    if (tail) return `${err.message ?? 'exec error'}\n${tail}`.trim()
  }
  return typeof e === 'object' && e !== null && 'message' in e && typeof (e as Error).message === 'string'
    ? (e as Error).message
    : String(e)
}
