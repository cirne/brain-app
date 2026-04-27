/**
 * One-shot `POST /api/inbox/sync` for onboarding. Must run for both `not-started` and
 * `indexing`: the server can already be in `indexing` after refresh, a new container, or
 * a fast align patch, in which case the old client-only-`not-started` gate never fired.
 */
export function shouldKickOnboardingInboxSync(args: {
  state: string
  mailConfigured: boolean
  alreadyKicked: boolean
}): boolean {
  if (args.alreadyKicked || !args.mailConfigured) {
    return false
  }
  return args.state === 'not-started' || args.state === 'indexing'
}
