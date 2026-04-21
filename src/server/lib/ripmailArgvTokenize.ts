/**
 * Tokenize the argument tail after the ripmail binary path (no shell).
 * Supports double-quoted segments as produced by JSON.stringify for CLI args.
 */
export function tokenizeRipmailArgString(input: string): string[] {
  const s = input.trim()
  if (!s) return []
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++
    if (i >= s.length) break
    const c = s[i]!
    if (c === '"') {
      i++
      let buf = ''
      while (i < s.length) {
        const ch = s[i]!
        if (ch === '\\') {
          i++
          if (i < s.length) buf += s[i]!
          i++
          continue
        }
        if (ch === '"') {
          i++
          break
        }
        buf += ch
        i++
      }
      out.push(buf)
      continue
    }
    if (c === "'") {
      i++
      let buf = ''
      while (i < s.length && s[i] !== "'") {
        buf += s[i]!
        i++
      }
      if (i < s.length && s[i] === "'") i++
      out.push(buf)
      continue
    }
    let start = i
    while (i < s.length && !/\s/.test(s[i]!)) i++
    out.push(s.slice(start, i))
  }
  return out
}
