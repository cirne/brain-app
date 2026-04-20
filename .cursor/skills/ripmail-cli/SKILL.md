---
name: ripmail-cli
description: Develops the ripmail Rust CLI in this monorepo (crate at ripmail/)—build, test, layout, and docs. Use when the user invokes /ripmail-cli, or when changing ripmail IMAP/SQLite/CLI code, integration tests, or embedded skills in the binary. Not the end-user /ripmail email workflow (see ripmail/skills/ripmail/ for the published agent playbook).
---

# ripmail — Rust CLI development (this repo)

**Not** the end-user “email in the agent loop” skill. That lives in [`ripmail/skills/ripmail/`](../../../ripmail/skills/ripmail/SKILL.md) and is what `ripmail skill install` / `cargo install-local` can copy to a host. This file is for **editing the ripmail crate** in **brain-app**.

## Read first

- **[`ripmail/AGENTS.md`](../../../ripmail/AGENTS.md)** — commands, TDD, no-migrations policy, `SCHEMA_VERSION`, `cargo run` vs `PATH` binary
- **[`ripmail/docs/ARCHITECTURE.md`](../../../ripmail/docs/ARCHITECTURE.md)** — storage, sync, ADRs before changing behavior
- **[`ripmail/docs/CLI_COPY.md`](../../../ripmail/docs/CLI_COPY.md)** — when changing CLI output, JSON shapes, `hints`, text tables

Root monorepo rules: **[`AGENTS.md`](../../../AGENTS.md)** (`nvm use` before any `npm`/`node`; tests required for fixes/features).

## Crate layout

| Area | Path |
|------|------|
| CLI entry / subcommands | `ripmail/src/cli/`, `ripmail/src/main.rs` |
| DB / FTS / schema | `ripmail/src/db/` |
| Sync / IMAP | `ripmail/src/sync/` |
| Inbox / rules | `ripmail/src/inbox/`, `ripmail/src/rules.rs` |
| Integration tests | `ripmail/tests/` |
| Embedded end-user skill (compile-time) | `ripmail/skills/ripmail/` |

Workspace: **`Cargo.toml`** at repo root — members `ripmail`, `desktop`; default member **`ripmail`**.

## Commands (repo root)

Always prefer the **crate under development**, not an older `ripmail` on `PATH`:

```bash
# Run CLI from sources (note `--` before ripmail flags)
cargo run -p ripmail -- search "foo"
cargo run -p ripmail -- inbox 24h --text
```

**Format / lint / tests** (from repository root):

```bash
cargo fmt -p ripmail -- --check
cargo clippy -p ripmail -- -D warnings
cargo t -p ripmail
```

Equivalent via npm (after **`nvm use`** at repo root):

```bash
npm run ripmail:test
npm run ripmail:dev      # debug build
npm run ripmail:build    # release build
```

Parallel tests: **`cargo t`** maps to **`cargo nextest`** per root **`.cargo/config.toml`** alias (see **`AGENTS.md`**).

## Changing behavior

- **Bug fix:** failing test first (see **`ripmail/AGENTS.md`** TDD section), then fix.
- **CLI / JSON:** update **`docs/CLI_COPY.md`** expectations and **`tests/`** where output is asserted.
- **SQLite schema:** bump **`SCHEMA_VERSION`** and rely on drift/rebuild semantics — no hand-written migrations (**`ripmail/AGENTS.md`**).
- **End-user skill text** shipped with the binary: edit **`ripmail/skills/ripmail/`**; release **`ripmail`** embeds it at compile time.

## Packaging context

brain-app runs a **bundled release** `ripmail` from **`desktop:bundle-server`** / Tauri flows. After substantive CLI changes, maintainer verification often includes **`npm run ripmail:build`** (and full desktop bundle when touching integration).

## Related

- **[`ripmail/docs/RELEASING.md`](../../../ripmail/docs/RELEASING.md)** — shipping binaries / tags
- Desktop + **`RIPMAIL_HOME`**: **[`.agents/skills/desktop/SKILL.md`](../desktop/SKILL.md)**
