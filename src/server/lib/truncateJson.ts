/**
 * Safely truncate a JSON string to fit within `maxChars` while keeping it valid JSON.
 *
 * Strategy:
 * - If the string is already within `maxChars`, return it as-is.
 * - If it parses as a JSON **array**, removes items from the middle and inserts a
 *   `{ __note__, __removed__, __total__ }` sentinel so the LLM knows data was elided.
 * - For everything else (objects, primitives, non-JSON text), falls back to a plain
 *   string truncation with a text marker appended.
 *
 * Used by the SSE layer to replace the raw `.slice(0, N)` that produced broken JSON
 * when tool results (e.g. calendar events) exceeded the limit.
 */
export function truncateJsonResult(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const trimmed = text.trim()

  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown[]
      if (Array.isArray(arr) && arr.length > 1) {
        const total = arr.length

        // Build a candidate array: head items + note sentinel + tail items
        const build = (head: number, tail: number): string => {
          const removed = total - head - tail
          const note = {
            __note__: `${removed} item${removed === 1 ? '' : 's'} removed from middle (result trimmed to ${maxChars} chars)`,
            __removed__: removed,
            __total__: total,
          }
          const parts = [
            ...arr.slice(0, head),
            note,
            ...(tail > 0 ? arr.slice(total - tail) : []),
          ]
          return JSON.stringify(parts, null, 2)
        }

        // Start with just the note (head=0, tail=0) and greedily add items
        let head = 0
        let tail = 0

        // Ensure even a note-only result fits; if not, fall through to plain truncation
        if (build(0, 0).length > maxChars) {
          throw new Error('note itself too large')
        }

        // Alternate adding from head and tail
        while (true) {
          const tryHead = head + 1 + tail <= total - 1 ? build(head + 1, tail) : null
          const tryTail = head + tail + 1 <= total - 1 ? build(head, tail + 1) : null

          const headFits = tryHead !== null && tryHead.length <= maxChars
          const tailFits = tryTail !== null && tryTail.length <= maxChars

          if (!headFits && !tailFits) break

          // Prefer head; if only tail fits, use tail
          if (headFits) {
            head++
          } else {
            tail++
          }
        }

        return build(head, tail)
      }
    } catch {
      // Not valid JSON or note too large — fall through to plain truncation
    }
  }

  // Fallback for non-array JSON or plain text
  const marker = `\n...[result truncated to ${maxChars} chars — response was ${text.length} chars total]`
  return text.slice(0, maxChars - marker.length) + marker
}
