# ripmail — Agent Guide

**Monorepo:** This crate lives inside **[brain-app](../AGENTS.md)** at `ripmail/`. Repository-wide conventions and the web app stack are documented there; this file stays focused on ripmail behavior and Rust workflows.

**ripmail** is an agent-first email system. It syncs email from IMAP providers, indexes it locally, and exposes it as a queryable dataset via a **CLI** (subprocess-friendly JSON/text). **Implementation:** **Rust** at the repository root (`cargo build`, `cargo test`). **End-user install:** prebuilt **Rust** binaries from **GitHub Releases** via `**install.sh`**. **Outbound mail** uses SMTP send-as-user (`ripmail send`, `ripmail draft`) for most providers. **Gmail + Google OAuth** (`imap.gmail.com`, `imapAuth: googleOAuth`) sends via **Gmail API HTTPS** (`users.messages.send`) so installs work where outbound SMTP is blocked (e.g. DigitalOcean — see brain-app BUG-013). Optional `RIPMAIL_SEND_TEST=1` restricts recipients for dev/test (see [ADR-024](docs/ARCHITECTURE.md#adr-024-outbound-email--smtp-send-as-user--local-drafts)).

**Quick install (prebuilt Rust binary — default):**

```bash
curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash
# If there is no stable Release yet, the script installs from the nightly prerelease automatically.
# Force nightly: bash -s -- --nightly   or   RIPMAIL_CHANNEL=nightly
# Custom prefix (must be on `bash`, not `curl`):  curl -fsSL ... | INSTALL_PREFIX=~/bin bash
```

**Troubleshooting:** If you see `**BASH_SOURCE[0]: unbound variable`**, `raw.githubusercontent.com` is serving a cached old `install.sh` (npm-era wrapper). Open [install.sh on GitHub](https://github.com/cirne/zmail/blob/main/install.sh) and confirm the file starts with “Install prebuilt ripmail (Rust)” — if it does but `curl` still fails, install from the commit URL shown on that page (Raw), or clone the repo and run `**bash install.sh`** locally.

**From source (dev / contributors):**

```bash
cargo install-local   # build --release + install binary + symlink skills/ripmail → ~/.claude/skills/ripmail (set INSTALL_PREFIX; skip skill: RIPMAIL_SKIP_CLAUDE_SKILL=1)
# Copy-only (e.g. CI artifact already at target/release/ripmail): cp target/release/ripmail "$INSTALL_PREFIX/ripmail" && chmod 755 "$INSTALL_PREFIX/ripmail"
# After: cargo install --path .  # puts `ripmail` and `cargo-install-local` in ~/.cargo/bin so `cargo install-local` works outside the repo
```

## Key documents

- **End users of ripmail (publishable skill `/ripmail`):** `[skills/ripmail/SKILL.md](skills/ripmail/SKILL.md)` — [Agent Skills](https://agentskills.io/specification.md) playbook (`name: ripmail`); install, setup, sync, usage; see `[skills/README.md](skills/README.md)`. Distinct from internal `**.cursor/skills/*`** below.
- **Developing this repo in Cursor:** `.cursor/skills/` — internal skills (`commit`, `db-dev`, `install-local`, `process-feedback`, `**ripmail-cli`** for Rust CLI work in `ripmail/`). Not the publishable user skill in `skills/ripmail/`.
- `[docs/CLI_COPY.md](docs/CLI_COPY.md)` — **draft** checklist for CLI user-facing copy and output (JSON/text/`hints`); includes `**hints` in JSON**; review when changing CLI output ([commit workflow](.cursor/commands/commit.md))
- `[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)` — technical decisions and rationale (**read before making storage, sync, or interface decisions**)
- `[docs/RELEASING.md](docs/RELEASING.md)` — **maintainers:** tag and ship Rust binaries (GitHub Releases + `Cargo.toml` version alignment)
- `[docs/VISION.md](docs/VISION.md)` — product vision
- `[docs/OPPORTUNITIES.md](docs/OPPORTUNITIES.md)` — product improvement ideas

**Single source of truth:** each fact lives in one place. Update the canonical docs or code not copies. DRY.

## Early development: no user base, clean breaks

**All agents should default to this mindset.**

- **ripmail is early-stage** and does **not** yet have a meaningful production user base.
- **Do not implement migrations** (no migration files, no versioned upgrade scripts) and **do not add backward-compatibility logic** “for existing installs.”
- **Changing an interface** (CLI flags, JSON shapes, config keys): **update callers and docs to the new shape**; do **not** keep parallel support for the old interface unless a maintainer explicitly asks for a transition period.
- **Changing the SQLite schema:** bump `**SCHEMA_VERSION`** in code (see `src/db/`). On open, drift detection **rebuilds the local index from maildir** — no hand-written `ALTER` path is required for normal development.
- **Intent:** avoid compatibility slop. Assume **fresh data + fresh expectations**; prefer the **simplest** design that matches the current product, not the union of every past variant.

## Tech stack

**Rust:** workspace root — `clap` CLI, `**rusqlite`** with bundled SQLite, `**imap`** crate, FTS5. **Dev:** `cargo run`, `cargo test`; **release:** `cargo build --release` → `./target/release/ripmail`. See **[ADR-025](docs/ARCHITECTURE.md#adr-025-rust-port--parallel-implementation-pre-cutover)** and the root **[README.md](README.md)** (architecture and developing from source).

**Implementation tracker** (intentional choices, risks, future work): [docs/RUST_PORT.md](docs/RUST_PORT.md). **Packaging / cutover context:** [OPP-030 archived](docs/opportunities/archive/OPP-030-rust-port-cutover.md).

```bash
# From repository root (Rust)
cargo test
cargo run -- search "foo"
cargo run -- ask "your question"   # OpenAI ask pipeline (requires RIPMAIL_OPENAI_API_KEY in env or ~/.ripmail/.env)
cargo run -- sync --foreground --since 7d
cargo run -- refresh
cargo build --release && ./target/release/ripmail status
```

### Gmail OAuth — HTTPS send (SMTP-blocked hosts)

When **`imap.gmail.com`** and **`googleOAuth`** are configured, **`ripmail send`** uses **Gmail REST API** on port **443**, not SMTP to **`smtp.gmail.com:587`**.

**Google Cloud Console (same project as `GOOGLE_OAUTH_CLIENT_ID`):**

1. Enable **Gmail API**: **APIs & Services → Library** → **Gmail API** → **Enable**.
2. **Scopes:** Existing OAuth already requests **`https://mail.google.com/`**, which authorizes `users.messages.send`. If you still get HTTP **403** after enabling the API, confirm that scope on the OAuth consent screen; optionally add **`https://www.googleapis.com/auth/gmail.send`** in Brain [`src/server/lib/googleOAuth.ts`](../src/server/lib/googleOAuth.ts) and ripmail [`src/oauth/google_flow.rs`](src/oauth/google_flow.rs), then users must **re-consent**.

**Gmail + app password** continues to use **SMTP** only; if the network blocks SMTP, prefer **OAuth**.

**Manual E2E:** unset **`RIPMAIL_SEND_TEST`** when sending to arbitrary addresses (`RIPMAIL_SEND_TEST=1` allows only **`lewiscirne+ripmail@gmail.com`**). From repo root:

```bash
RIPMAIL_HOME=/path/to/your/oauth/ripmail/home \
  cargo run -p ripmail -- \
  send \
  --to lewiscirne@gmail.com \
  --subject "Gmail API HTTPS smoke" \
  --body "Ripmail Gmail API send test." \
  --text
```

Expect stderr to mention **Gmail API** / **`users.messages.send`**, not **SMTP** to port **587**.

**Confirm delivery:** pull latest mail, then triage or search (same **`RIPMAIL_HOME`**):

```bash
RIPMAIL_HOME=/path/to/your/oauth/ripmail/home \
  cargo run -p ripmail -- refresh --foreground
RIPMAIL_HOME=/path/to/your/oauth/ripmail/home \
  cargo run -p ripmail -- inbox 24h --text
```

If the test send was **to yourself**, the thread may land in **Inbox** or **Sent** depending on Gmail; use **`ripmail search "your subject"`** if **`inbox`** does not list it yet.

**Optional live integration test:** `tests/gmail_api_live_send.rs` is **`#[ignore]`**. Run with **`RIPMAIL_LIVE_GMAIL_SEND=1`**, **`RIPMAIL_HOME`** set to an OAuth Gmail home, and **`cargo nextest run -p ripmail -E 'test(live_gmail_https)' --run-ignored only`**.

**Agents and contributors:** always invoke the CLI from a git clone with `**cargo run -- <subcommand> …`** (note the `--` so Cargo does not swallow flags). A `ripmail` binary on `PATH` may be an older install or release than the sources you are editing.

`**cargo test` parallelism:** By default, Cargo uses one parallel `rustc` job per logical CPU for builds, and the Rust test harness runs tests in parallel across logical CPUs when `RUST_TEST_THREADS` is unset (see comments in `[.cargo/config.toml](.cargo/config.toml)`; this repo does not cap jobs). For serial tests: `RUST_TEST_THREADS=1 cargo test`.

If multiple `**ripmail`** binaries are on `**PATH`**, the shell resolves whichever comes first — use `cargo run --` when developing this repo, or an explicit path to the binary you intend to run.

## Project structure

```
src/            Rust CLI + library; cargo workspace root
tests/          Rust integration tests (`cargo test`)
Cargo.toml      Rust workspace
```

## Development rules

- **Rust:** `cargo fmt`, `cargo clippy`, `cargo test` from the **repository root**.
- Never commit email data, credentials, or `.db` files.

### Worktree cleanup (standard practice)

When a worktree task is complete, always merge to main and delete the worktree:

```bash
# From main
git merge claude/<worktree-name>
git worktree remove .claude/worktrees/<worktree-name>
git branch -d claude/<worktree-name>
```

Never leave completed worktrees around. Check with `git worktree list`.

- **No migrations; no backward-compat layers by default** — see [Early development: no user base, clean breaks](#early-development-no-user-base-clean-breaks). **Schema:** bump `SCHEMA_VERSION`; drift rebuild handles it. Optional local hacks: manual SQL on a dev DB or wipe `~/.ripmail/data/` and resync.

## Planning and test coverage

**When creating a plan (plan mode), you must articulate the test coverage strategy.** No plan is complete without specifying:

- **What tests must be created** — new test files or test cases needed
- **What tests must be changed** — existing tests that need updates due to behavior changes
- **What tests must be passing** — acceptance criteria: which existing and new tests must pass to consider the work done

The test strategy should cover:

- Unit tests for new/changed functions/modules
- Integration tests for CLI commands
- Eval tests (LLM-based) for `ripmail ask` functionality when applicable
- Edge cases and error handling
- Backward compatibility — **omit unless the task explicitly requires it** (early dev default: clean breaks; see [Early development](#early-development-no-user-base-clean-breaks))

A plan without a clear test coverage strategy is incomplete and should not be considered ready for implementation.

## Bug fixes — TDD workflow

When fixing a bug, follow this sequence:

1. **Write a failing test first** — create a test (unit or integration, whichever is most appropriate) that reproduces the bug. Confirm it fails before touching any fix code.
2. **Implement the fix** — make the minimal change needed to make the test pass.
3. **Confirm the test passes** — run the specific test to verify.
4. **Run the full test suite** — `cargo test` to confirm no regressions.

## Processing riptest feedback

The sibling project `../riptest` hosts Claude Code config for manual testing. When agents discover issues, they write feedback files to `../riptest/feedback/`. Process this feedback using the **process-feedback** skill:

1. **Read feedback files** from `../riptest/feedback/*.md`
2. **Check for duplicates** — search existing bugs (`docs/bugs/`) and opportunities (`docs/opportunities/`)
3. **Check if fixed** — if feedback matches archived/fixed items, delete the feedback file
4. **Convert to bugs/opportunities** — create new bug (`docs/bugs/BUG-XXX-*.md`) or opportunity (`docs/opportunities/OPP-XXX-*.md`) files
5. **Update indexes** — add entries to `docs/BUGS.md` or `docs/OPPORTUNITIES.md`

See `.cursor/skills/process-feedback/SKILL.md` for the complete workflow. The `docs/bugs/` and `docs/opportunities/` directories serve as our issue tracker (Jira replacement).

## Commands

**Rust (repository root):**

```bash
cargo test
cargo run -- --help
cargo run -- inbox 24h --thorough   # iterate on inbox scan without release build
cargo build --release
./target/release/ripmail status
```

### CLI Commands

ripmail search  [--limit n] [--from addr] [--after date] [--since date] [--before date] [--include-noise] [--json] [--text] [--result-format auto|full|slim]  # `--since`/`-s` = same lower bound as `--after` (mutually exclusive with `--after`)
ripmail who [query] [--limit n] [--mailbox <email|id>] [--text]  (omit query for top contacts; JSON includes `personId`, `displayName`, optional `suggestedDisplayName`, counts — see [docs/CLI_COPY.md](docs/CLI_COPY.md))
ripmail whoami [--mailbox <email|id>] [--text]  # configured identity plus heuristics from indexed outbound mail; JSON — see [docs/CLI_COPY.md](docs/CLI_COPY.md)
ripmail read … [--raw] [--json] [--text]  # multiple ids: JSON array (2+), text separated by --- ripmail ---
ripmail thread  [--json] [--text]
ripmail ask "" [--verbose]  # Answer a question about your email (requires RIPMAIL_OPENAI_API_KEY); -v logs pipeline progress
ripmail refresh [--since ] [--backfill|--init] [--foreground] [--force] [--text] [--mailbox <email|id>]  # sync local mail; plain refresh runs a one-time backward backfill per empty mailbox using sync.defaultSince; --since/--backfill backfill explicitly; use --foreground when blocking on backfill; `mailboxType: "applemail"` indexes from local Apple Mail (no IMAP) — see [OPP-050](docs/opportunities/OPP-050-applemail-localhost-mailbox.md)
ripmail inbox [] [--since YYYY-MM-DD] [--thorough] [--text]  # deterministic triage (~/.ripmail/rules.json + fallback; no OpenAI); run refresh first when recency matters
ripmail archive ... [--undo]  # Message-ID as in search/inbox JSON (bare or <...>); local is_archived; optional IMAP when mailboxManagement enabled; JSON stdout
ripmail status [--json] [--imap]
ripmail stats [--json]
ripmail config [--id ] [--email ] [--preferred-name …] [--full-name …] [--signature …] [--signature-id …] [--mailbox-management on|off]  # non-secret settings; requires existing mailboxes (see `ripmail config --help` for env vars)
ripmail clean [--yes]              # preview wipe of RIPMAIL_HOME; with --yes removes all ripmail data and config (same scope as `ripmail wizard --clean`)
ripmail rebuild-index              # Wipe SQLite and reindex from local maildir (dev/test; same as schema bump)
ripmail attachment list  [--text]   # `--message-id` / `-m` accepted as alias
ripmail attachment read  | [--raw] [--no-cache]
ripmail send [--to addr --subject s] []   # SMTP for most providers; Gmail+OAuth uses Gmail API HTTPS; saved draft under data/drafts/ (.md optional); optional RIPMAIL_SEND_TEST=1 for dev/test allowlist
ripmail draft new|reply|forward|list|view|edit|rewrite [--help]   # Local drafts (data/drafts/); new/reply/forward optional --mailbox (send-as; reply/forward path resolution multi-inbox); reply/forward: `<message-id>` positional or `--message-id`; prefer `draft new|reply|forward --instruction` for LLM compose (new: omit `--subject`; reply/forward: do not combine with `--subject`/`--body`/`--body-file`) + `draft edit` over literal `--body` (verbatim fallback); list JSON: slim/full like search (--result-format); bodyPreview when full; edit = LLM instruction, rewrite = replace body; edit/rewrite support --to/--cc/--bcc, --add-*/--remove-*, rewrite --keep-body
ripmail rules validate [--sample]|reset-defaults --yes|list|show |add|edit |remove [--yes|-y] |move |feedback   # ~/.ripmail/rules.json v3 search queries (--query); validate --sample runs DB counts when data/ripmail.db exists

```

**`ripmail inbox` — fast vs thorough:** Default is the **fast** path (category filter on candidates, cached decisions when **`rules_fingerprint`** matches). **`--thorough`** is the **slow/complete** path: **all** categories, **recompute** classifications (bypass cache), **include archived** mail in the window, **replay** (ignore prior surfaced dedup). **`--reapply`** is the same slow/complete path with an agent-oriented name — use after **`rules.json`** changes to re-triage indexed mail in the window (optionally widen the window, e.g. **`ripmail inbox 30d --reapply`**). Hidden compatibility flags `--include-all`, `--reclassify`, `--replay` still work and combine with `OR` semantics against the same toggles.

**Inbox JSON (agents):** Rows include **`decisionSource`**, **`matchedRuleIds`**, optional **`winningRuleId`**, and optional **`hints`**. **`requiresUserAction`**, **`actionSummary`**, and **`counts.actionRequired`** remain in the schema for compatibility; **v1** deterministic inbox keeps action-required **false** / empty unless extended later. **`ripmail archive`** drops mail from the unarchived scan window; it does **not** clear persisted columns on **`inbox_decisions`**. End-user workflow: `[skills/ripmail/SKILL.md](skills/ripmail/SKILL.md)`.

**Archived mail in the scan:** included when **`--thorough`**, **`--reapply`**, or **`--reclassify`** (hidden). **`search` / `read`** always see archived mail.

**Stale `rules.json`:** On load, if **`version`** is below the current in-tree format (**`RULES_FILE_FORMAT_VERSION`** in `src/rules.rs`) or any rule uses **`kind: "regex"`**, ripmail **replaces** the file with bundled defaults and keeps the previous copy as **`rules.json.bak.<uuid>`** (same outcome as **`ripmail rules reset-defaults --yes`**).

See `[docs/ASK.md](docs/ASK.md)` for **`ripmail ask`** vs primitives and for the **compose loop** (`ripmail draft` → **`ripmail draft edit`** / **`rewrite`** → **`ripmail send <draft-id>`**). Publishable playbook: `[skills/ripmail/SKILL.md](skills/ripmail/SKILL.md)`.

### Sync logging and background execution

**Recommended:** Run sync in the background for long-running syncs. Each sync run writes a log file to `{RIPMAIL_HOME}/logs/sync-{date}-{time}.log`:

```bash
# Run sync in background
ripmail refresh --since 1y &

# Check sync status
ripmail status

# Inspect the latest log (stdout shows log path)
tail -f ~/.ripmail/logs/sync-*.log
```

The CLI prints the log file path to stdout (e.g., `Sync log: ~/.ripmail/logs/sync-20250306-143022.log`) so agents can tail/inspect it. Verbose logging goes to the file, not stdout, making background execution clean.

**Using `ripmail` from the repo:** `cargo run -- <command> [args]` from the repository root, or `./target/release/ripmail` after `cargo build --release`.

**Local install + skill link:** `cargo install-local` from the repo root builds the release binary, installs to `INSTALL_PREFIX` (default `~/.local/bin`), and symlinks `skills/ripmail/` → `~/.claude/skills/ripmail` unless `RIPMAIL_SKIP_CLAUDE_SKILL=1`. Override skill dir with `RIPMAIL_CLAUDE_SKILL_DIR`; copy instead of symlink: `RIPMAIL_CLAUDE_SKILL_MODE=copy`.

**Prebuilt binary + embedded skill:** The release `ripmail` binary embeds `skills/ripmail/` at compile time (same version as the CLI). After a successful `**ripmail setup`** (validated credentials), ripmail copies that embedded tree to `~/.claude/skills/ripmail` and to `~/.openclaw/skills/ripmail` when `~/.openclaw/skills` exists—unless `**--no-skill**` or `**RIPMAIL_SKIP_CLAUDE_SKILL**` / `**RIPMAIL_SKIP_OPENCLAW_SKILL**`. Run `**ripmail skill install**` anytime to refresh from the embedded copy. `**ripmail wizard**` offers optional confirms for Claude and OpenClaw at the end of a session.

### Attachment commands

```bash
ripmail attachment list <message_id>       # list attachments for a message (JSON)
ripmail attachment read <message_id> <index>|<filename>   # extract as markdown/CSV (stdout); index 1-based or exact filename
ripmail attachment read <message_id> <index>|<filename> [--raw] [--no-cache]   # --raw: binary; --no-cache: re-extract
```

Supported formats: PDF, DOCX, XLSX, HTML, CSV, TXT. Extraction happens on first read and is cached in the DB.

**CLI help and onboarding (no env required):** `ripmail --help` and `ripmail -h` print a **concise command list** (`src/cli/root_help.txt` + `src/main.rs`). When no mailbox is configured yet, bare `ripmail` (no args) prints only `**src/cli/first_run_help.txt`** (wizard vs non-interactive `setup`, OAuth note)—not the full root command list; after config exists, bare `ripmail` matches long help (same list as `ripmail --help`). `**ripmail --version`** prints the version plus **how to upgrade/reinstall** the prebuilt binary (`install.sh` one-liners, nightly, `INSTALL_PREFIX`); `**ripmail -V`** is version only (clap short vs long version). `**ripmail help`** is accepted like `-h` where the CLI parses it. Use `**ripmail <command> --help`** for flags and examples. When to use `**ripmail ask`** versus search/read/thread/who/attachment and the **draft + send** loop: [docs/ASK.md](docs/ASK.md) and the end-user skill ([skills/ripmail/references/CANONICAL-DOCS.md](skills/ripmail/references/CANONICAL-DOCS.md), [skills/ripmail/references/DRAFT-AND-SEND.md](skills/ripmail/references/DRAFT-AND-SEND.md)). **Progressive disclosure:** JSON output may include a `**hints`** array (and truncation metadata); text mode may print similar tips after results—read them before inventing a new approach. If any command fails due to missing config, the CLI prints "No config found. Run 'ripmail setup' or 'ripmail wizard' first."

**Setup (CLI/agent-first):** Provide credentials via flags or env vars. For interactive prompts, use `ripmail wizard`. **Post-install settings** (per-mailbox identity, `mailboxManagement`, and similar non-secret keys) use `**ripmail config`** — not `setup` — when you are not running a credential/bootstrap flow.

**Required credentials:**

1. Email address (e.g., `user@gmail.com`) — provided via `--email` flag or `RIPMAIL_EMAIL` environment variable
2. **IMAP authentication:** either a **Gmail app password** (`--password` / `RIPMAIL_IMAP_PASSWORD`) or, for Gmail when app passwords are unavailable, `**ripmail setup --google-oauth`** (browser OAuth; see [OPP-042](docs/opportunities/OPP-042-google-oauth-cli-auth.md)). OAuth uses `RIPMAIL_GOOGLE_OAUTH_*` env vars (or release-embedded client id/secret); refresh tokens are stored under `~/.ripmail/<mailbox_id>/google-oauth.json` with `imapAuth: "googleOAuth"` in `config.json`.
3. OpenAI API key (optional, for future features) — provided via `--openai-key` flag or `RIPMAIL_OPENAI_API_KEY` (or `OPENAI_API_KEY`) environment variable

```bash
ripmail setup --email user@gmail.com --password "app-password" --openai-key "sk-..." [--no-validate]
# Or via environment variables:
RIPMAIL_EMAIL=user@gmail.com RIPMAIL_IMAP_PASSWORD="app-password" RIPMAIL_OPENAI_API_KEY="sk-..." ripmail setup
# Gmail OAuth (no app password):
ripmail setup --email user@gmail.com --google-oauth --openai-key "sk-..."
```

**Google OAuth — `redirect_uri_mismatch`:** The authorize URL’s `redirect_uri` must match **Authorized redirect URIs** on your Desktop OAuth client. `**ripmail wizard --gmail`** and `**ripmail setup --google-oauth**` both use **loopback** — `**RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI`** or the default `**http://127.0.0.1:8765/oauth/callback**` (must include **host, port, and path**; bare `http://localhost` is not valid for ripmail). Optional: `**write_google_oauth_setup_hosted`** / `**RIPMAIL_OAUTH_RELAY_BASE**` for an HTTPS redirect relay (advanced). The CLI prints the exact redirect URI before opening the browser. Details: [OPP-042](docs/opportunities/OPP-042-google-oauth-cli-auth.md).

## Search

Search uses FTS5 full-text search for keyword matching.

Search JSON includes attachment info: **full** rows list per-file metadata (`id`, `filename`, `mimeType`, `size`, `extracted`, `index` — same 1-based index as `attachment read`); **slim** rows (large result sets with auto format) include a count plus `attachmentTypes` (MIME subtype strings). Text/table output shows 📎 with counts. For `stored_path` or when not searching first, use `ripmail attachment list <message_id>`.

## Configuration

ripmail stores configuration in `~/.ripmail/` (or `$RIPMAIL_HOME` if set). **Legacy default directory:** when `RIPMAIL_HOME` is unset, if `~/.zmail` contains `config.json` and `~/.ripmail` is missing—or exists but is empty and has no `config.json`—the CLI renames `~/.zmail` → `~/.ripmail` once at startup (before any subcommand runs, including bare `ripmail`) and prints an informational line to stderr.

- `~/.ripmail/config.json` — non-secret settings (sync defaults, optional `attachments.cacheExtractedText`, optional `inbox.defaultWindow` for `ripmail inbox` when no window is passed — default `24h`). **New installs** from `ripmail setup` / `ripmail wizard` write a `**mailboxes`** array (per-mailbox email and IMAP host/port). Each mailbox may include optional `**identity`** (`preferredName`, `fullName`, `signatureId`, `signatures`) for LLM compose and display. **Legacy** top-level `**imap`** is still loaded until migrated; see [OPP-016 archived](docs/opportunities/archive/OPP-016-multi-inbox.md). Optional `**mailboxManagement.enabled`** controls IMAP archive propagation (default `false` — local-only); set via `**ripmail config --mailbox-management on|off`** or the wizard's shared-settings prompt.
- `~/.ripmail/.env` — shared secrets (e.g. `RIPMAIL_OPENAI_API_KEY`, optional `RIPMAIL_GOOGLE_OAUTH_*` for OAuth client settings). **Local dev from a git clone:** a **repository root** `.env` next to `Cargo.toml` is **merged** over `~/.ripmail/.env` for the same keys (project wins) — convenient for `RIPMAIL_GOOGLE_OAUTH_*` without duplicating into ripmail home. With the `**mailboxes`** layout, `**RIPMAIL_IMAP_PASSWORD**` for each account is stored under `**~/.ripmail/<mailbox_id>/.env**` (derived id from the email) when using app passwords; **Google OAuth** mailboxes store tokens in `**~/.ripmail/<mailbox_id>/google-oauth.json`** instead. Legacy single-mailbox installs may still keep IMAP password in the root `.env`.

Attachment extracted-text cache is **off by default** (each read re-extracts). To use cached extraction on repeat reads, set `"attachments": { "cacheExtractedText": true }` in config.json.

IMAP archive propagation is **off by default** (`ripmail archive` updates local `is_archived` only). To also move messages on the server when archiving, enable it via `ripmail config --mailbox-management on` or the wizard shared-settings prompt; this writes `"mailboxManagement": { "enabled": true }` to config.json. For **Gmail**, when sync has populated `**messages.labels`** from `**X-GM-LABELS**`, provider archive may use `**UID STORE … -X-GM-LABELS (\Inbox)**` on the `**[Gmail]/All Mail**` UID (no INBOX search) and fall back to search if that fails — see [OPP-049 archived](docs/opportunities/archive/OPP-049-gmail-archive-stored-labels-metadata.md) and **[docs/GMAIL_ARCHIVE_NOTES.md](docs/GMAIL_ARCHIVE_NOTES.md)** (retrospective: latency, tradeoffs, what we keep).

Run `ripmail setup` (with flags/env) or `ripmail wizard` (interactive) to create these files:

- `**ripmail setup`** — CLI/agent-first. Provide `--email`, `--password` (or `--google-oauth` for Gmail OAuth), `--openai-key` or env vars. No prompts.
- `**ripmail wizard`** — Interactive. **First install:** one linear flow for the first mailbox, then OpenAI and default sync window. **When mailboxes already exist:** pick **an inbox** (edit or delete), add another via **IMAP (email and password, any provider)** or **Gmail (Sign in with Google)**, or **Done** (finish). There is no separate shared-settings menu item; **after** you add or edit a mailbox (and optional background `ripmail refresh`), the wizard prompts **shared settings** (OpenAI + default sync window) before returning to the list. At the end of a wizard session, optional prompts install the embedded `**/ripmail`** agent skill for Claude Code and (when `~/.openclaw/skills` exists) OpenClaw. List-based prompts instead of Y/n where possible. Delete removes the mailbox from config, deletes its per-account directory under `~/.ripmail/`, and purges that mailbox’s rows from the local SQLite index (search/read no longer reference removed mail). For a full reindex from maildir (e.g. after a schema bump or manual repair), use `**ripmail rebuild-index**`. Gmail: app-password hints as before.
- Creates `~/.ripmail/` if it doesn't exist
- Validates credentials (IMAP connection test, OpenAI API test) unless `--no-validate` is used

Optional environment variables:

- `RIPMAIL_HOME` — override config directory (default: `~/.ripmail`)
- `RIPMAIL_LLM_PROVIDER` — override default LLM provider (`openai`, `anthropic`, `ollama`); can also set `llm.provider` in `config.json`. Optional `llm.fastModel` / `llm.defaultModel` name the fast vs default-quality models ([OPP-046](docs/opportunities/archive/OPP-046-llm-provider-flexibility.md))
- `RIPMAIL_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` — when using Anthropic
- `RIPMAIL_OLLAMA_API_KEY` — optional; **local Ollama does not require a key** — if unset, ripmail uses a placeholder string for the OpenAI-compatible client (Ollama ignores it)

**Note:** `ripmail rebuild-index` parallelizes `.eml` parsing using OS threads sized from `std::thread::available_parallelism()` (see `src/rebuild_index.rs`); there is no `RIPMAIL_WORKER_CONCURRENCY` knob in the Rust CLI.

Required environment variables (for `ripmail setup`):

- `RIPMAIL_EMAIL` — Email address (e.g., `user@gmail.com`)
- `RIPMAIL_IMAP_PASSWORD` — IMAP app password when not using OAuth (Gmail app password, not regular password)
- `RIPMAIL_OPENAI_API_KEY` (or `OPENAI_API_KEY`) — OpenAI API key (optional, for future features)

**Note:** The correct environment variable names are `RIPMAIL_EMAIL` and `RIPMAIL_IMAP_PASSWORD`. Do not use `IMAP_USER` or `IMAP_PASSWORD` — these are outdated and not supported.