# ripmail

Email as a queryable dataset for AI agents.

Modern email systems are human-first — designed around inbox browsing and manual workflows. **ripmail** reimagines email as a structured, searchable dataset with a native interface for AI agents.

## What it does

- Syncs email from IMAP (Gmail-first) into local storage (`~/.ripmail/data/maildir`, SQLite index at `~/.ripmail/data/ripmail.db`)
- Indexes for **FTS5** full-text search and exposes a **CLI** for agents and scripts
- Supports agent-optimized shortlist → hydrate workflows via CLI search controls

## Quick start

1. **Install** (see [AGENTS.md](AGENTS.md) for options)

   **Prebuilt Rust binary (recommended):**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash
   ```

   **From source** (repository root):

   ```bash
   cargo install-local   # build release + install; set INSTALL_PREFIX (see AGENTS.md)
   ```

2. **Configure credentials** (writes under `~/.ripmail/`, or `$RIPMAIL_HOME` — `config.json`, per-account secrets, etc.)

   - **Interactive (prompts):** `ripmail wizard` — use this for a guided first-time setup on a terminal.
   - **Non-interactive (agents, scripts, CI):** `ripmail setup` — pass `--email` and **either** `--password` (Gmail app password) **or** `--google-oauth` (browser sign-in for Gmail when app passwords are not available), plus optional `--openai-key`, or the equivalent `RIPMAIL_`* env vars (no prompts). See `ripmail setup --help` and [AGENTS.md](AGENTS.md) for OAuth env vars and redirect-URI notes.

   Both paths validate IMAP (and optional OpenAI) unless you pass `--no-validate`.

3. **Bring the local index up to date**

   ```bash
   ripmail refresh --since 7d --foreground
   ```

   **Deterministic triage over the local index** (run `ripmail refresh` first when you need the latest mail):

   ```bash
   ripmail inbox
   ```

4. **Search (header-first default)**

   ```bash
   ripmail search "apple receipt after:30d" --json
   ```

## CLI

Overview (aligned with `ripmail --help` and bare `ripmail` once configured; before config, bare `ripmail` prints setup hints only; canonical text: [src/cli/root_help.txt](src/cli/root_help.txt)):


| Area           | Commands                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Setup          | `ripmail setup` (non-interactive; flags/env), `ripmail wizard` (interactive)                                    |
| Sync / index   | `ripmail refresh …`, `ripmail rebuild-index`                                                                    |
| Inbox / triage | `ripmail ask`, `ripmail inbox`, `ripmail rules …`, `ripmail archive …`                                              |
| Search & read  | `ripmail search`, `ripmail who`, `ripmail read`, `ripmail thread`, `ripmail attachment list`, `ripmail attachment read` |
| Outbound       | `ripmail send`, `ripmail draft …`                                                                               |
| Status         | `ripmail status`, `ripmail stats`                                                                               |


```bash
ripmail refresh [--since <spec>] [--backfill] [--foreground] [--force] [--text] [--mailbox <id>]
ripmail search <query> [--limit <n>] [--from <addr>] [--after <date>] [--before <date>] [--mailbox <id>]
                  [--include-all] [--category <name>] [--result-format auto|full|slim] [--timings]
                  [--json|--text]
ripmail inbox [<window>] [--since YYYY-MM-DD] [--thorough] [--text]
ripmail archive <message-id> … [--undo]
ripmail status [--json] [--imap]
ripmail stats [--json]
ripmail read <id> [--raw] [--json|--text]
ripmail thread <id> [--json|--text]
```

Query text can use inline operators: `from:`, `to:`, `subject:`, `after:`, `before:` (e.g. `ripmail search "from:alice@example.com invoice OR receipt"`). Run `ripmail <command> --help` for full flags.

### Agents and the CLI

Use **ripmail** as a subprocess: prefer **`ripmail setup`** (plus env vars) for automated installs; use **`ripmail wizard`** when a human is at the keyboard. Commands default to JSON where results are structured (search, who, attachment list) or text for content-heavy output (read, thread, status, stats). Override with `--text` or `--json` where supported. See [AGENTS.md](AGENTS.md) and [docs/ASK.md](docs/ASK.md) for orchestration and the draft/send loop.

### Recommended agent retrieval pattern

```bash
# 1) Fast shortlist
ripmail search "from:no_reply@email.apple.com receipt after:30d" \
  --limit 10 --result-format slim --json

# 2) Hydrate selected IDs
ripmail read "<message-id>"

# Optional: fetch original raw MIME source
ripmail read "<message-id>" --raw
```

For a **maildir-only** SQLite reindex without deleting raw email (e.g. after a schema bump), use `ripmail rebuild-index` — see [AGENTS.md](AGENTS.md).

## Architecture

**Implementation:** Rust at the workspace root — IMAP sync, SQLite + FTS5, CLI, attachments, SMTP/drafts, and LLM-shaped commands (`ripmail ask`, `ripmail inbox`). Configuration and data live under **`RIPMAIL_HOME`** (default **`~/.ripmail`**). All data stays on your machine — no cloud sync service, no third-party access to your email.

**Documentation:**

- [AGENTS.md](AGENTS.md) — installation, commands, and development
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — technical decisions and rationale ([ADR-025](docs/ARCHITECTURE.md#adr-025-rust-port--parallel-implementation-pre-cutover): Rust implementation)
- [docs/RUST_PORT.md](docs/RUST_PORT.md) — tracker, intentional choices, risks, and future work
- [docs/opportunities/archive/OPP-030-rust-port-cutover.md](docs/opportunities/archive/OPP-030-rust-port-cutover.md) — packaging and cutover context
- [docs/VISION.md](docs/VISION.md) — product vision

**CI and releases:** [.github/workflows/ci.yml](.github/workflows/ci.yml) (fmt, clippy, test, release build on Ubuntu); [.github/workflows/release-builds.yml](.github/workflows/release-builds.yml) (tag `v*` releases, daily **nightly** prerelease, manual dispatch). **Cutting a versioned Rust release:** [docs/RELEASING.md](docs/RELEASING.md).

### Developing from source (Rust)

From the repository root:

```bash
cargo test
cargo run -- --help
cargo build --release
./target/release/ripmail status
# IMAP sync (uses RIPMAIL_HOME / credentials)
cargo run -- refresh --foreground --since 7d
cargo run -- inbox
# Natural-language Q&A (OpenAI)
cargo run -- ask "summarize invoices from last week" --verbose
```

Unit tests live in `src/` under `#[cfg(test)] mod tests { ... }` next to the code they exercise. Integration tests are one crate per file under `tests/` (e.g. `search_fts`) and exercise the public CLI end-to-end. After changing a module, a fast check is `cargo test --lib <filter>`; run full `cargo test` before merging.

**`cargo test` and CPU cores:** By default, Cargo uses one parallel `rustc` job per logical CPU for builds (`cargo test` included). The Rust test harness also runs tests in parallel across logical CPUs when `RUST_TEST_THREADS` is unset. This is documented in [.cargo/config.toml](.cargo/config.toml) (we do not cap jobs). To force serial tests (e.g. clearer logs), run `RUST_TEST_THREADS=1 cargo test`.

**Install:** prebuilt binary via `install.sh` (above) or `cargo build --release`; local prefix install with `cargo install-local` (see [AGENTS.md](AGENTS.md)). Copy-only after a build: `cp target/release/ripmail "$INSTALL_PREFIX/ripmail" && chmod 755 "$INSTALL_PREFIX/ripmail"`.

## Status

Active development. Core sync/index/search flows are working; CLI search interface is being expanded for agent-first workflows.

## License

MIT
