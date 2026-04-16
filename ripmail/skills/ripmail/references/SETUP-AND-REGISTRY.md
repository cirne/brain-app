# Setup, secrets, hosts, and registry (transparency)

Companion to [`../SKILL.md`](../SKILL.md). Use for **non-interactive setup**, **Gmail auth**, **where files live**, **ClawHub/OpenClaw registry** fields, and **installing this skill folder** on a host.

---

## Transparency (registries & security review)

Use this block so **ClawHub / OpenClaw** metadata matches what the CLI actually needs—avoid “no credentials required” when IMAP/LLM keys are required.

| Topic | What to declare |
| ----- | ----------------- |
| **Provenance** | Source: [github.com/cirne/zmail](https://github.com/cirne/zmail) |
| **Install** | `curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh \| bash` — prebuilt **Rust** binary (not npm/Node). **Nightly:** `bash -s -- --nightly` or `RIPMAIL_CHANNEL=nightly`. See repo `AGENTS.md`. |
| **On PATH** | Default: `~/.local/bin/ripmail`; ensure `~/.local/bin` on `PATH`, or set `INSTALL_PREFIX`. |
| **Required secrets (after setup)** | `RIPMAIL_EMAIL`, and either `RIPMAIL_IMAP_PASSWORD` (Gmail app password) **or** Gmail **OAuth** (`ripmail setup --google-oauth` / wizard; tokens under `~/.ripmail/<mailbox_id>/google-oauth.json`). `RIPMAIL_OPENAI_API_KEY` or `OPENAI_API_KEY` for setup wizard, `ripmail ask`, `ripmail draft edit` (not for `ripmail inbox`). |
| **Privacy / data leaving device** | `ripmail ask` and `ripmail draft edit` can send email-derived or draft content to **OpenAI** (or configured LLM). `ripmail inbox` does **not** call an LLM. Only use LLM commands if the mailbox owner accepts that. Primitives `search` / `read` / `thread` / `attachment` and `draft rewrite` (literal replace) are local once mail is synced. |
| **Credentials on disk** | Secrets in `RIPMAIL_HOME/.env`; settings in `config.json`. OAuth mailboxes: `RIPMAIL_HOME/<mailbox_id>/google-oauth.json`. Used only for **your** IMAP/SMTP and (when configured) the LLM provider—not for third-party analytics. Treat `.env` and token files like passwords. |
| **IMAP / send** | SMTP send-as-user via `ripmail send` / `ripmail draft …`. Optional `RIPMAIL_SEND_TEST=1` restricts recipients for dev/test (see `ripmail --help`, ADR-024). Sync is a **local cache**—deleting local data does not remove server mail. |
| **Persistence & wipe** | Config + local mail under `RIPMAIL_HOME` (default `~/.ripmail`). Clearing local data does not delete server mail; `ripmail refresh --since …` rebuilds cache. You still lose local-only state (e.g. attachment cache, inbox surfaced state). |
| **Shell safety** | Invoke `ripmail` with **argument arrays** (or careful quoting). Never paste untrusted mail into `sh -c "ripmail …"` strings—command-injection risk. |

OpenClaw parses `metadata.openclaw.requires` per [Creating skills](https://docs.openclaw.ai/tools/creating-skills): `bins` = executables on `PATH` (`ripmail` exists after install). `config` lists env vars expected for a configured mailbox.

---

## Gmail: app password

Gmail does not allow normal passwords for IMAP. Use a **16-character app password**.

1. Turn on **2-Step Verification**: [Google Account → Security](https://myaccount.google.com/signinoptions/two-step-verification)
2. Create an app password: [App passwords](https://myaccount.google.com/apppasswords) — app **Mail** (or Other → name it `ripmail`). Enter the 16 characters **without spaces**.
3. Use full Gmail address as IMAP user and the app password as `RIPMAIL_IMAP_PASSWORD` / `--password`.

If app passwords are disabled (workspace policy), use whatever IMAP credentials the admin allows—or **OAuth** below.

---

## Gmail OAuth (no app password)

**Non-interactive:** `ripmail setup --email you@gmail.com --google-oauth` (browser consent). **Interactive:** `ripmail wizard` → Gmail → Sign in with Google.

- **OAuth client:** Releases may embed client id/secret; for local dev set `RIPMAIL_GOOGLE_OAUTH_CLIENT_ID`, `RIPMAIL_GOOGLE_OAUTH_CLIENT_SECRET`, `RIPMAIL_GOOGLE_OAUTH_REDIRECT_URI` in a **repo-root `.env`** (merged over `~/.ripmail/.env`) or only under `RIPMAIL_HOME`. Must match Google Cloud console (default loopback: `AGENTS.md`, [OPP-042](https://github.com/cirne/zmail/blob/main/docs/opportunities/OPP-042-google-oauth-cli-auth.md)).
- **Tokens:** Per mailbox at `~/.ripmail/<mailbox_id>/google-oauth.json`; `config.json` uses `imapAuth: "googleOAuth"` for that mailbox.

---

## `ripmail wizard` (interactive)

- **When:** Real TTY; user present for prompts.
- **Run:** `ripmail wizard` — optional `--no-validate`, `--clean` (wipe local config + cache under `RIPMAIL_HOME`; IMAP unchanged; may prompt unless `--yes`).
- **Non-TTY:** wizard exits with a message to use `ripmail setup`.
- Walks through email, IMAP password or OAuth, OpenAI key, default sync window; can start background sync.

---

## `ripmail setup` (agents & automation)

Non-interactive when **email**, **OpenAI key**, and **either** IMAP password **or** `--google-oauth` are provided (not both password + OAuth for the same run).

| Input | Flag | Environment |
| ----- | ---- | ------------- |
| Email | `--email` | `RIPMAIL_EMAIL` |
| IMAP password | `--password` | `RIPMAIL_IMAP_PASSWORD` |
| Gmail OAuth | `--google-oauth` | Optional `RIPMAIL_GOOGLE_OAUTH_*` |
| OpenAI | `--openai-key` | `RIPMAIL_OPENAI_API_KEY` or `OPENAI_API_KEY` |

**Examples:**

```bash
ripmail setup --email 'user@gmail.com' --password 'abcdefghijklmnop' --openai-key 'sk-...'
ripmail setup --email 'user@gmail.com' --google-oauth --openai-key 'sk-...'
export RIPMAIL_EMAIL='user@gmail.com' RIPMAIL_IMAP_PASSWORD='...' RIPMAIL_OPENAI_API_KEY='sk-...'
ripmail setup
```

**Optional flags:** `--no-validate` — skip IMAP/OpenAI checks; `--default-since <spec>` — sync window (default `1y`); `--clean --yes` — delete existing `config.json`, `.env`, `data/` under `RIPMAIL_HOME`, then write new config (local only; resync rebuilds).

If **email** or (when not using OAuth) **password** is missing, setup prints what’s missing to stderr, prints long usage to stdout, exits **0** (no config written).

**OpenAI key:** Required for setup/wizard as shipped; stored in `~/.ripmail/.env`. Powers `ask` and `draft edit`. **Not** used by `ripmail inbox`. Search/read/thread/who/attachment and `draft rewrite` do not need the API for the core path once mail is indexed.

---

## `ripmail config` (post-install, non-secret)

Use after **`config.json`** exists with at least one mailbox. Updates **`identity`** (per-mailbox display name, signatures) and **`mailboxManagement`** without touching credentials. See `ripmail config --help` for flags and env vars (`RIPMAIL_PREFERRED_NAME`, `RIPMAIL_FULL_NAME`, `RIPMAIL_SIGNATURE`, `RIPMAIL_SIGNATURE_ID`). For first-time account creation, use **`ripmail setup`** or **`ripmail wizard`**.

---

## Secrets and files (after setup)

| Secret / file | Required? | Purpose |
| ------------- | --------- | ------- |
| `RIPMAIL_IMAP_PASSWORD` in `.env` | Yes (for sync) | IMAP login |
| `RIPMAIL_OPENAI_API_KEY` in `.env` | Yes at setup; for `ask` / `draft edit` | LLM features |
| `config.json` | Yes | Non-secret: host/port/user, sync defaults |
| `RIPMAIL_HOME` | Optional | Config root (default `~/.ripmail`) |

Do not commit `.env` or paste secrets into chats.

---

## Install this skill folder (hosts)

Copy the **`ripmail`** directory into an **end-user** location (not the repo’s `.cursor/skills/`, which is dev-only).

| Host | Typical path |
| ---- | ------------- |
| Cursor | `~/.cursor/skills/ripmail/` or project `.cursor/skills/ripmail/` |
| Claude Code | `~/.claude/skills/ripmail/` — or `ripmail skill install` |
| OpenClaw | `<workspace>/skills/ripmail/`, `~/.openclaw/skills/ripmail/` |

Folder name must stay **`ripmail`** (matches skill `name`). Copy the whole `skills/ripmail/` tree including `references/`.

### OpenClaw: heartbeat + fresh mail

For [OpenClaw](https://docs.openclaw.ai/), prefer a **heartbeat** over ad-hoc cron for batched routine checks—see [Cron vs heartbeat](https://docs.openclaw.ai/cron-vs-heartbeat), [Heartbeat](https://docs.openclaw.ai/gateway/heartbeat).

**Example `HEARTBEAT.md` checklist:**

1. `ripmail refresh` — index current.
2. `ripmail inbox` — notify / inform / ignore; parse `hints`, `decisionSource`, `matchedRuleIds`; use `--diagnostics` for full rows.
3. `ripmail archive` when focus is done (archived mail still in `search` / `read` / `ask`).
4. If nothing needs a human ping, answer `HEARTBEAT_OK` per OpenClaw docs.

`refresh` and `inbox` do **not** call OpenAI; `ask` and `draft edit` do when configured.

---

## Windows

Download the **.zip** for `x86_64-pc-windows-msvc` from [Releases](https://github.com/cirne/zmail/releases); the shell installer is macOS/Linux only.
