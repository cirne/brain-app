# Security

ripmail is **local-first**: your mail is synced into a directory under your machine, indexed in a local SQLite database, and accessed through a CLI on that same machine. There is **no ripmail-operated cloud** that stores your mailbox or credentials.

This document describes how that model works today, what the project aims to do responsibly, and what **you** should do when installing and using ripmail alongside other sensitive data on your system.

## Data and secrets on disk

With default layout, ripmail keeps configuration and data under `**RIPMAIL_HOME`** (default `**~/.ripmail**`), including:

- `**config.json**` — non-secret settings (hosts, ports, sync defaults, mailbox list). Email addresses may appear here.
- `**.env` files** — secrets in dotenv form, same idea as many other tools: typically `**RIPMAIL_IMAP_PASSWORD`**, and optionally `**RIPMAIL_OPENAI_API_KEY**` (or `**OPENAI_API_KEY**`). Multi-mailbox setups may use a root `.env` and/or **per-mailbox** `.env` files under each mailbox directory.
- `**data/`** — local mail storage (maildir-style layout), SQLite index (e.g. `**ripmail.db**`), drafts, caches, and logs as implemented.

Anyone with **filesystem access** to these paths (or backups that include them) can read your mail and secrets. That is the same class of risk as **any app that stores mail or credentials locally** (desktop mail clients, `~/.ssh`, API tokens in `~/.config`, etc.).

## Network use

When you run ripmail, it may connect to:

- **Your email provider** over **IMAP** (sync, and optionally mailbox operations you enable) and **SMTP** (sending mail), using settings from your config. Connections use the stack and options provided by the implementation (e.g. TLS where configured by the provider and client).
- **OpenAI’s API** when you use features that call the API (e.g. `ripmail ask`, or LLM-assisted draft flows), using your API key from the environment or `.env`. Those requests contain **only what you or the command sends** in that session (e.g. prompts and relevant message context)—not a separate upload of your whole disk.

ripmail does **not** introduce a separate “ripmail sync service” that holds your mail off-device.

## What we consider best practices in the product

- **Local storage by design** — indexing and search run against your local copy; the trust boundary is **your machine** and your **provider accounts**.
- **Secrets in `.env`-style files** — familiar pattern; keep them **out of version control**, screen shares, and bug reports.
- **Open source, binary by default** — the implementation is published for review; **normal installs use a prebuilt binary** (e.g. `install.sh` / GitHub Releases). Running ripmail does **not** require Rust or Cargo on your machine.

We do not claim formal certification or audit; the project is **early-stage** software—see **[README.md](README.md)** and **[AGENTS.md](AGENTS.md)** for behavior and recovery (e.g. schema changes and local rebuilds).

## What we recommend for users and installers

1. **Treat `RIPMAIL_HOME` like any sensitive directory** — restrict OS user accounts, full-disk encryption, and backups accordingly.
2. **Protect `.env` and `config.json`** — file permissions appropriate for your OS; never commit them to git or paste them into chats, issues, or logs.
3. **Use provider-appropriate credentials** — e.g. app passwords or scoped tokens where your provider supports them; rotate if exposed.
4. **Minimize API key scope** — use a dedicated OpenAI key if you use LLM features; revoke or rotate if leaked.
5. **Install from trusted sources** — e.g. official repo releases and documented install paths; verify checksums or source when your threat model requires it.
6. **Stay aware of what runs on your machine** — ripmail is a powerful tool over your mail; compromised hosts or malicious plugins/scripts that invoke the CLI share the same risks as other local tools.

If your bar is “nothing sensitive on disk,” **no** local IMAP client meets that bar; ripmail is in the **same category** as keeping a local mail store and credentials for Thunderbird, Apple Mail, or similar—plus explicit API keys for optional AI features.

## Reporting security issues

If you believe you have found a **security vulnerability** in ripmail (e.g. unexpected credential handling, unsafe defaults, or unintended data exposure), please report it **privately** rather than in a public issue, so we can assess and fix before wide disclosure. Open a **GitHub Security Advisory** for this repository if available, or contact the maintainers through the contact options on the project’s GitHub page.

For **general bugs** or feature requests, use normal issues as described in project documentation.