/** Pretty-print tool args for the expandable tool-call panel. */
export function formatToolArgs(args: unknown): string {
  if (!args) return ''
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}
