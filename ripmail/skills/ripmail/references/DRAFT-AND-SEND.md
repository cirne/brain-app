# Draft and send — agent workflow (detail)

This companion to [`../SKILL.md`](../SKILL.md) describes how agents **compose, iterate, and send** email with ripmail: **local drafts** on disk, **SMTP send-as-user**, and the same index as **`search` / `read` / `thread`**. For product rationale see **ADR-024** in `docs/ARCHITECTURE.md` at the repo or package root.

---

## Mental model

| Concept | What it means |
|--------|----------------|
| **Draft** | A file **`{id}.md`** under **`{RIPMAIL_HOME}/data/drafts/`** (default `~/.ripmail`). YAML frontmatter holds To/Cc/Bcc/Subject/reply metadata; the body is Markdown. |
| **`id`** | Filename **stem** (subject slug + `_` + eight alphanumeric chars). Use this with **`ripmail send <id>`** (with or without **`.md`**). |
| **Send** | **SMTP** using the same mailbox credentials as IMAP. Successful send **moves** the draft to **`data/sent/`** (not the provider’s “Sent” UI unless the server mirrors it—ripmail sends like a normal MUA). |
| **Not in Gmail Drafts** | Local drafts do **not** sync to the provider’s Drafts folder unless that feature is added later—treat them as **agent-local** until sent. |

---

## Prerequisites

- **`ripmail setup`** (or wizard) completed; **`RIPMAIL_IMAP_PASSWORD`** (and related) available for SMTP.
- For **LLM-assisted** steps: credentials per **`llm`** in **`config.json`** (default: **`RIPMAIL_OPENAI_API_KEY`** / **`OPENAI_API_KEY`**). Anthropic/Ollama/local: see [OPP-046](../../../docs/opportunities/archive/OPP-046-llm-provider-flexibility.md). Required for **`ripmail draft new --instruction`**, **`ripmail draft reply --instruction`**, **`ripmail draft forward --instruction`**, and **`ripmail draft edit`** when you rely on LLM compose or revision.
- **`ripmail draft rewrite`** and **`ripmail draft new`** with explicit **subject + body** do **not** need OpenAI for the core path.

---

## Phase 1 — Gather context (before you draft)

| Goal | Typical commands / tools |
|------|-------------------------|
| Find a message to reply to | **`ripmail search "…"`** → note **`message_id`** (and optionally **`thread_id`**) from results. |
| Read bodies for tone/facts | **`ripmail read <message_id>`**, **`ripmail thread <thread_id>`**. |
| Fuzzy question (“what did X say about Y?”) | **`ripmail ask "…"`** (single subprocess; uses OpenAI inside ripmail). |

**Rule of thumb:** Know **who** you are replying to and **which `message_id`** applies before **`draft reply`**.

---

## Phase 2 — Create a draft

**Default:** Prefer **`ripmail draft new --to … --instruction "…"`** (omit **`--subject`**), **`ripmail draft reply --message-id … --instruction "…"`**, or **`ripmail draft forward --message-id … --to … --instruction "…"`** as appropriate, and **`ripmail draft edit`** for further revision. Use **`--body`** / **`--body-file`** only when the message must be **verbatim** (quotes, templates, compliance). Do not combine **`--instruction`** with **`--subject`**, **`--body`**, or **`--body-file`** on reply/forward.

### New email (no prior message)

```bash
# Preferred: LLM generates subject + body from instruction (needs OpenAI key; do not pass --subject)
ripmail draft new --to 'colleague@example.com' --instruction 'Polite follow-up asking for ETA on the API review by Friday.'

# Verbatim / advanced: explicit subject + body (no LLM)
ripmail draft new --to 'colleague@example.com' --subject 'Project update' --body $'Hi,\n\nHere is the update.\n\n— You'
```

### Reply

Prefer **`--instruction`** for LLM subject + body (requires LLM credentials). Otherwise body via **`--body`** / **`--body-file`** (literal—**fallback**). **`--to`** / **`--subject`** override defaults when not using **`--instruction`** (default recipient is the original sender; subject defaults to **`Re: …`**). Optional **`--mailbox`** (account email or configured id) sets send-as and helps resolve the source **`.eml`** in multi-inbox layouts.

```bash
ripmail draft reply --message-id '<message-id-from-search>' --instruction 'Thanks — I will send the doc tomorrow with the API notes incorporated.'

ripmail draft reply --message-id '<message-id-from-search>' --body $'Thanks for the notes.\n\nI will send the doc tomorrow.'

# Optional: send as a specific account / disambiguate on-disk path
ripmail draft reply --message-id '<message-id-from-search>' --mailbox 'you@work.com' --instruction 'Brief thanks; will follow up tomorrow.'
```

### Forward

Requires **`--message-id`** and **`--to`**. Prefer **`--instruction`** for an LLM-generated preamble (requires LLM credentials); ripmail **inlines** the original message excerpt after the preamble. Otherwise optional **`--subject`**, **`--body`** / **`--body-file`** for a literal preamble. Optional **`--mailbox`** (email or id) sets send-as and helps resolve the source **`.eml`** when using multiple accounts.

```bash
ripmail draft forward --message-id '<message-id>' --to 'team@example.com' --instruction 'FYI — see below.'

ripmail draft forward --message-id '<message-id>' --to 'team@example.com' --body $'FYI — see below.\n'

# Optional: send as a specific account / disambiguate on-disk path
ripmail draft forward --message-id '<message-id>' --to 'team@example.com' --mailbox 'you@work.com' --instruction 'FYI for the team.'
```

---

## Phase 3 — Review and revise

### View

```bash
ripmail draft list [--text] [--result-format auto|full|slim]   # JSON: id, path, kind, subject; bodyPreview when full (auto slim if >50 drafts; same flag as search)
ripmail draft view <id> [--text] [--with-body]
```

JSON default shows path and headers; **`--with-body`** includes the body in JSON.

### LLM revision (CLI only today)

```bash
# Put --to / --cc / --add-cc / … before the instruction, or use -- before the instruction text.
ripmail draft edit <id> 'Shorten the second paragraph and make the tone more formal.'
ripmail draft edit <id> --add-cc 'boss@example.com' 'Make the tone more formal.'
```

Uses OpenAI; instruction can also come from **stdin** (pipe).

### Literal replacement (no LLM)

```bash
ripmail draft rewrite <id> 'Full new body text...' [--subject 'New subject'] [--to 'a@x.com,b@y.com'] [--cc '…'] [--bcc '…'] [--add-cc '…'] [--remove-cc '…'] [--keep-body]
# Or --body-file /path for large bodies. Recipient/subject-only changes omit the body (implicit keep body) or use --keep-body explicitly.
```

If the agent can edit files safely, update the existing **`{id}.md`** under **`data/drafts/`** (YAML frontmatter + body) before send.

---

## Phase 4 — Send

```bash
ripmail send <id> --dry-run    # validate recipients; no send (IMAP/SMTP not required until real send)
ripmail send <id>              # send; on success draft moves to data/sent/
```

**One-shot** (no draft file): **`ripmail send --to … --subject …`** (see **`ripmail send --help`**).

---

## Safety and testing

- **`RIPMAIL_SEND_TEST=1`** — Restricts recipients to the dev/test allowlist (see **`ripmail --help`** and ADR-024). Use when exercising send paths in non-production environments.
- **`--dry-run`** — **`ripmail send`** validates without delivering.
- **Quoting** — Prefer **argument arrays** from agents; avoid pasting untrusted text into **`sh -c "ripmail …"`** (injection risk).

---

## Where to go deeper

- **CLI discovery:** `ripmail draft --help`, `ripmail send --help` — source of truth for flags.
- **Ask vs search/read:** `docs/ASK.md` (when to use **`ripmail ask`** vs primitives for context).
