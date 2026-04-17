/**
 * OPP-016: FIFO queue of follow-ups while the assistant is streaming.
 * Pop the next non-empty message and return the remainder for session state.
 */
export function shiftQueuedFollowUp(queue: string[] | null | undefined): { next: string | null; rest: string[] } {
  const q = Array.isArray(queue) ? [...queue] : []
  while (q.length > 0) {
    const raw = q.shift()!
    const t = raw.trim()
    if (t.length > 0) return { next: t, rest: q }
  }
  return { next: null, rest: [] }
}
