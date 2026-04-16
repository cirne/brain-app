---

name: ripmail
description: >-
  Local-first email CLI: IMAP sync to SQLite + FTS5, structured JSON (no webmail). Agents use
  `search`, `read`, `thread`, `who`, `attachment`, `draft`, `send`, and `inbox` without leaving chat.
  `ripmail inbox` is deterministic rules (`rules.json`, no LLM); `ask`, `draft edit`, and setup/wizard use
  an LLM when configured (OpenAI default; optional `llm` in config — see repo OPP-046). Requires `ripmail`
  on PATH (`curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash`), IMAP
  credentials, and LLM keys only for those features. OTP/codes: optional `refresh`, then `search` + `read`
  (see references/AUTH-CODES.md). Source: github.com/cirne/zmail.
license: "Refer to [https://github.com/cirne/zmail](https://github.com/cirne/zmail) for project license and terms."
compatibility: >-
  `ripmail` on PATH (`install.sh` or `cargo install-local` from clone). Network: IMAP; LLM endpoint for
  ask/setup/draft edit. Disk: ~/.ripmail (SQLite + maildir).
metadata:
  version: "0.2.8"
  homepage: "[https://github.com/cirne/zmail](https://github.com/cirne/zmail)"
  repository: "[https://github.com/cirne/zmail](https://github.com/cirne/zmail)"
  openclaw:
    requires:
      bins:
        - ripmail
      config:
        - RIPMAIL_EMAIL
        - RIPMAIL_IMAP_PASSWORD
        - RIPMAIL_OPENAI_API_KEY

---

# /ripmail — Email in the agent loop

**What:** IMAP sync → local **SQLite + FTS5** + maildir cache. **No** traditional inbox UI—agents use the **CLI** (`--json` / `--text`). **SMTP** send-as-user for outbound.

**Local vs LLM:** Primitives (`search`, `read`, `thread`, `who`, `attachment`) and **`ripmail inbox`** use the **local index** only—**no** OpenAI. **`ripmail ask`**, **`draft edit`**, and **setup/wizard** call an LLM when keys exist—use only if the mailbox owner accepts that. **`draft rewrite`** is literal body/subject replace (no LLM on the core path).

**Personalization:** Durable **`~/.ripmail/rules.json`** (v3 search queries) drives **`ripmail inbox`**; maintain with `ripmail rules …`. Detail: [references/INBOX-CUSTOMIZATION.md](references/INBOX-CUSTOMIZATION.md).

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/cirne/zmail/main/install.sh | bash
```

- **Nightly:** `| bash -s -- --nightly` or `RIPMAIL_CHANNEL=nightly`. **Prefix:** `INSTALL_PREFIX=... bash`. **From clone:** `cargo install-local` (see repo `AGENTS.md`).
- **Skill copy:** Prebuilt `ripmail` embeds `skills/ripmail/`; run **`ripmail skill install`** → `~/.claude/skills/ripmail` (and OpenClaw when `~/.openclaw/skills` exists). **`setup`** does this by default; **`--no-skill`** skips.
- **Data:** `RIPMAIL_HOME` (default `~/.ripmail`): `config.json`, `.env`, `data/`.

**First-time auth:** **`ripmail setup`** (flags/env) or **`ripmail wizard`** (TTY). Gmail: **app password** or **OAuth**—[references/SETUP-AND-REGISTRY.md](references/SETUP-AND-REGISTRY.md).

---

## Agent checklist

1. Install; confirm **`which ripmail`**; **`hash -r`** / new shell if `~/.local/bin` was just added.
2. **`ripmail setup`** or **`ripmail wizard`** — [SETUP-AND-REGISTRY.md](references/SETUP-AND-REGISTRY.md).
3. **`ripmail refresh --since …`** then habitual **`ripmail refresh`** / **`ripmail status`**.
4. **Schedule `refresh`** (cron / launchd / heartbeat) so the index stays fresh; run **`refresh`** before mail work when **recency** matters.
5. Learn from the CLI: **`ripmail`**, **`ripmail --help`**, **`ripmail <cmd> --help`**; read JSON **`hints`** (and truncation fields) after each call.
6. **Questions:** default **`ripmail ask`**; switch to **`search` → `read` / `thread`** when you need exact rows, IDs, or attachments — [references/CANONICAL-DOCS.md](references/CANONICAL-DOCS.md) → repo `docs/ASK.md`.
7. **Compose:** [references/DRAFT-AND-SEND.md](references/DRAFT-AND-SEND.md) (`draft` → **`send <draft-id>`**).
8. **Inbox rhythm:** **`refresh`** → **`inbox`** → **`archive`** as needed — [INBOX-CUSTOMIZATION.md](references/INBOX-CUSTOMIZATION.md).
9. **OTP / codes:** [references/AUTH-CODES.md](references/AUTH-CODES.md).
10. Never paste secrets into chat.

---

## Inbox workflow

| Piece | Role |
| ----- | ---- |
| **Working set** | Unarchived mail (`is_archived = 0`). Only this set is triaged by **`inbox`**. |
| **`refresh`** | Pulls from IMAP into the local index. New/empty mailboxes: plain `refresh` runs one history pull via `sync.defaultSince`; then forward-only. **No** LLM. |
| **`inbox`** | Deterministic triage (**notify / inform / ignore**) from **`rules.json`** + fallback. JSON: **`decisionSource`**, **`matchedRuleIds`**, optional **`winningRuleId`**, **`hints`**. Use **`--diagnostics`** or **`--thorough`** for full rows / complete rescan. Run **`refresh`** first when recency matters. |
| **`archive`** | Removes from working **`inbox`** scan; **does not** hide mail from **`search` / `read` / `thread` / `ask`**. |

**Agents:** schedule **`refresh`**; run **`inbox`** on a cadence; **`archive`** when done; use **`search` / `read`** after archive if you need the thread again. **OTP:** [AUTH-CODES.md](references/AUTH-CODES.md).

---

## Agent workflow: draft and send (summary)

1. Context: **`search` → `read` / `thread`** (or **`ask`**) for replies/forwards.
2. **`ripmail draft new|reply|forward`** — prefer **`--instruction`** for LLM subject/body where appropriate; **`--mailbox`** for send-as / multi-account resolution.
3. **`draft view` / `draft list`**; optional **`draft edit`** (LLM) or **`draft rewrite`** (literal).
4. **`ripmail send <draft-id>`** (optional **`--dry-run`** first). Success moves draft to **`data/sent/`**. One-shot: **`ripmail send --to …`**.

**Safety:** **`RIPMAIL_SEND_TEST=1`** for dev/test recipient restriction. Full steps: [references/DRAFT-AND-SEND.md](references/DRAFT-AND-SEND.md).

---

## First sync and daily use

```bash
ripmail refresh --since 30d   # initial backfill (background OK; note log path on stdout)
ripmail refresh
ripmail status
ripmail inbox                 # or: ripmail inbox 24h
ripmail ask "your question"
ripmail search 'query'
```

Long **`refresh --since`** is safe in background. **Outbound:** see [DRAFT-AND-SEND.md](references/DRAFT-AND-SEND.md).

---

## Login / OTP / verification codes

**Source of truth:** **`search`** then **`read`** on the best **`message_id`**—do not rely only on **`refresh`** stdout. Prefer primitives over **`ask`** for simple code lookup. Detail: [references/AUTH-CODES.md](references/AUTH-CODES.md).

---

## Keeping mail fresh

Only **synced** mail is in SQLite/FTS. **`refresh`** before **`search` / `read` / `thread` / `attachment` / `ask`** when recency matters. Users: schedule **`refresh`**; agents on OpenClaw can fold into **heartbeat** — see **OpenClaw** in [references/SETUP-AND-REGISTRY.md](references/SETUP-AND-REGISTRY.md).

---

## ripmail ask vs primitives

| Prefer **`ask`** | Prefer **primitives** |
| ---------------- | --------------------- |
| Broad NL questions | Exact filters, known IDs, every row |
| One synthesized answer | Full bodies, raw EML, attachments |

**Rule of thumb:** start with **`ask`**; drill in with **`search` → `read`**. Tradeoffs: repo **`docs/ASK.md`**, index in [CANONICAL-DOCS.md](references/CANONICAL-DOCS.md).

---

## Registry, security, and hosts

**ClawHub / OpenClaw:** full transparency table (secrets, privacy, shell safety), **Gmail** steps, **`setup`** flag table, **skill install paths**, **OpenClaw heartbeat** — [references/SETUP-AND-REGISTRY.md](references/SETUP-AND-REGISTRY.md).

---

## More detail

- [references/CANONICAL-DOCS.md](references/CANONICAL-DOCS.md) — CLI discovery, **`hints`**, repo doc table
- [references/SETUP-AND-REGISTRY.md](references/SETUP-AND-REGISTRY.md) — setup, Gmail, registry, hosts
- [references/AUTH-CODES.md](references/AUTH-CODES.md) — OTP / verification codes
- [references/DRAFT-AND-SEND.md](references/DRAFT-AND-SEND.md) — compose, reply, forward, send
- [references/INBOX-CUSTOMIZATION.md](references/INBOX-CUSTOMIZATION.md) — **`rules.json`**, triage maintenance
