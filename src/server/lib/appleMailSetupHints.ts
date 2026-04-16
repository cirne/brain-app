/**
 * ripmail prints a generic "terminal app" FDA line; Brain runs ripmail from Brain.app or dev.
 * Append actionable macOS guidance when the failure looks like Mail path / FDA.
 */
export function enrichAppleMailSetupError(raw: string): string {
  const msg = raw.trim()
  if (!msg) return msg
  if (msg.includes('Ensure **Brain** is listed under System Settings')) return msg

  const lower = msg.toLowerCase()
  const looksFdaOrMail =
    lower.includes('full disk access') ||
    lower.includes('library/mail') ||
    lower.includes('could not find apple mail')

  if (!looksFdaOrMail) return msg

  const hint =
    ' — Ensure **Brain** is listed under System Settings → Privacy & Security → Full Disk Access with access allowed (privacy panes often look greyed out in screenshots and screen recordings — that does not mean the toggle is off). Quit Brain completely (Cmd+Q), reopen, then try again. Apple Mail should be installed at least once so ~/Library/Mail exists; ripmail reads that folder.'

  return msg + hint
}
