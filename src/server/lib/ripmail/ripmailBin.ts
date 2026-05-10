/**
 * Path to the `ripmail` executable.
 *
 * Server mail runs **in-process** (`@server/ripmail`); this only exists for the few
 * remaining string-builder helpers / tests that interpolate the binary name. The
 * supported way to run the CLI manually is **`npm run ripmail -- <subcommand> …`**
 * (requires `ripmail` on `PATH`).
 */
export function ripmailBin(): string {
  return 'ripmail'
}
