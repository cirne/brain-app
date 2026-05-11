# Archived: OPP-083 — iMessage + unified messaging index

**Status: Archived (2026-05-11).** Ripmail corpus backlog closed for tracking.

**Stub:** [../OPP-083-imessage-and-unified-messaging-index.md](../OPP-083-imessage-and-unified-messaging-index.md)

---

## Original spec (historical)

### OPP-083: iMessage + Unified Messaging Index (Telegram, etc.)

**Former ripmail id:** OPP-045 (unified backlog 2026-05-01).

**Status:** Paused — **learnings captured; retry later.** A prototype branch exercised an iMessage → SQLite ingest path and surfaced design mismatches worth fixing before another attempt.

**Created:** 2026-04-08. **Updated:** 2026-04-08 (post-experiment).

## Summary

ripmail’s index is **email-centric** (IMAP + maildir + FTS). Many users also want **SMS/iMessage** and **other chat** in a **single query surface** (“what did we agree on in any channel?”). This opp still tracks **indexing non-email streams** into the **same local SQLite database** (or a clearly unified schema), with a **`channel` discriminator**, **connector sync cursors** separate from IMAP, and a **handles / persons** story for cross-channel identity.

**What changed after the experiment:** we should **not** treat chat as “small email.” The next attempt should prioritize **thread-native read/search UX**, **identity normalization** (phones vs emails vs display names), and **plain indexed text** — and **avoid** forcing chat through **synthetic MIME/EML** as the primary representation.

## Learnings from the experiment (2026)

These are implementation-agnostic lessons from wiring iMessage into ripmail and using it end-to-end.

### Chat is thread-native; email is often message-native

iMessage bubbles are **short** and **sequential**; meaning usually lives in **turn order and participants**, not in a single blob. **Email** is often **self-contained**: one fetch is enough context.

**Implication:** Default **agent and CLI** flows for chat should emphasize **thread slices** (recent *N* messages, time window, or explicit thread id) — not “`read` one synthetic document” as the happy path. A **heavy RFC822-shaped layer** for every bubble fights that mental model.

### Synthetic EML was the wrong primary fit

To reuse the mail pipeline, a prototype **fabricated minimal RFC822 bytes** for connector-only rows (no maildir file). That let one code path call `mail-parser`, but:

- Chat is **not** MIME mail; faking `From`, `Date`, and `Message-ID` is awkward.
- **mail-parser** (0.9) showed **real bugs** on synthetic headers (e.g. RFC3339 `Date:` mis-parsed to garbage timestamps; bare-phone `From` and `Message-ID: imessage:…` compounded confusion).
- Workarounds (DB-first `read`, RFC2822 `Date`, bracketed addresses) prove the stack is **fighting the abstraction**.

**Implication:** Prefer a **first-class chat row shape** for `read` / tools / `ask` (body + timestamp + participants + `thread_id` from SQLite). Reserve **EML** for **real on-disk mail** or explicit export — not as the default internal representation of iMessage.

### Identity: phones, emails, and names do not line up like mail

Ingest used **handle strings** from Apple (`+1…`, `me`, sometimes email). Search/`who`/`read` are built around **email-shaped** `from_address` fields. **Display names** are often missing in the index; **the same human** can appear as a phone in chat and an email in mail — **merge is not automatic**.

**Implication:** A serious cross-channel story needs explicit **handles → person** (or equivalent) and UX for **merge/link**, not only string equality on `from_address`. See [Unified identity across channels](#unified-identity-across-channels-exploration) and [OPP-077](OPP-077-who-smart-address-book.md).

### `chat.db` text is incomplete on modern macOS

Apple often stores **`message.text` as NULL** for many rows; **text (or equivalents) may live in `attributedBody` / other blobs** (format varies by OS version). Ingest that only reads **`message.text`** will index **many empty bodies** — **FTS and snippets look empty even when Messages.app shows text**.

**Implication:** Budget **decoding or alternate columns** for full text, or accept **partial coverage** and document it. **Tests** should use realistic snapshots, not only legacy `text`-populated rows.

### Rebuild and drift: maildir ≠ chat

`rebuild-index` / schema drift rebuild **from maildir** repopulates **email**. **Connector** rows (iMessage, etc.) are **not** in maildir; after a rebuild they **disappear** until the connector runs again. This is **expected** with the current architecture but easy to forget in UX and docs.

**Implication:** After schema bumps or rebuild, **re-run non-IMAP connectors** (or print a **one-line hint**). Longer-term, a **clear “re-ingest chat”** story or **cursor** behavior in docs helps.

### Permissions and environment unchanged

**Full Disk Access** for the process running `ripmail`, **WAL snapshot** copy for consistent reads, **undocumented schema** drift — all remain **real operational costs**. None of this is a reason to avoid the feature; it **is** a reason to keep the connector **opt-in** and **maintained**.

## Problem

- Cross-channel memory is fragmented: email is in ripmail; chats live in Messages.app, Telegram, Slack, etc.
- Agents want **one** searchable corpus with **time range, thread, and participants** — not a separate tool per app.
- **New:** Without **thread-aware** and **identity-aware** design, chat in ripmail feels like **broken email** (empty snippets, wrong dates, phone-only handles).

## Direction (next attempt)

1. **iMessage (macOS)** — Same technical feasibility as before: read-only ingest from **`~/Library/Messages/chat.db`** (snapshot), **FDA**, macOS-only. **Improve:** ingest **searchable text** using whatever columns are actually populated on target OS versions; **map** handles into a **stable handle model** early.
2. **CLI / agent surfaces** — Prefer **`thread`** (or a dedicated subcommand) returning **ordered messages** with **snippets/bodies** for chat, without MIME as the default. **`read` single message** for chat can remain secondary.
3. **No EML as the default internal shape for chat** — Store **body_text + metadata** in SQLite; present **JSON/text** aligned with chat, not fake headers.
4. **Unified index** — Keep the **`channel`** discriminator, **`channel_sync_state`**, FTS with `channel` scoping — as in [Database schema](#database-schema-exploration). **Reuse FTS patterns** where one row = one searchable message still makes sense.
5. **Telegram (phase 2)** — Unchanged: similar row shape, different auth/sync.

## Technical feasibility (iMessage on macOS)

**Read-only indexing of the user’s own local data remains feasible** for a **local CLI** with **FDA**. Apple does **not** ship a supported bulk export API; feasibility depends on **community schema knowledge** and **ongoing maintenance**.

| Topic | Notes |
| --- | --- |
| **Data location** | `~/Library/Messages/chat.db` (+ WAL/SHM); local replica; SMS when synced via Continuity. |
| **Access** | Read-only file access or consistent snapshot copy. |
| **Permissions** | **Full Disk Access** for the host process; explain **Settings → Privacy & Security → Full Disk Access**. |
| **WAL** | Snapshot copy + WAL files for consistency while Messages.app is open. |
| **Schema stability** | Not an Apple contract; expect **breakage** across major macOS versions; connector tests + updates. |
| **Distribution** | Feasible for **unsandboxed CLI**; **App Store** sandbox is a poor fit for arbitrary `chat.db` reads. |
| **Sending / UI automation** | Out of scope for indexing; different policy surface. |

## Ingestion and storage (exploration)

**Still recommended:** ingest **copy text into ripmail’s SQLite** for unified FTS; do **not** treat live `chat.db` as the runtime store for every search.

**Add to the model:** **text extraction** must match **real** macOS behavior (`text` vs `attributedBody` / summaries). **Metadata-only** or **snippet-only** phases are still valid for experiments, but **empty-body syndrome** should be understood as **data source**, not only bugs.

## Database schema (exploration)

Unchanged intent: **`channel`** on `messages` / `threads`, **namespaced** `message_id` or `(channel, external_id)`, **`channel_sync_state`** for non-IMAP cursors, **one FTS** with `channel` where practical, **SCHEMA_VERSION** bump + **re-ingest** story for connector changes. See [AGENTS.md](../../ripmail/AGENTS.md) early-dev notes on drift and rebuild.

**Threads:** Avoid **id collisions** between email and chat (`thread_id` + channel or prefixing).

## config.json (exploration)

Unchanged intent: keep **`mailboxes`** for IMAP; add **optional** `imessage` (or **`connectors[]`**) for opt-in chat connectors; **default search scope** = union of included mailboxes and opted-in connectors.

## Unified identity across channels (exploration)

**More important after the experiment:** cross-channel **“who is this?”** requires **handles** (phone, email, provider ids) and **optional person merge** — not a single `from_address` string. See [OPP-077](OPP-077-who-smart-address-book.md).

## Non-goals (initial)

- Sending iMessage or Telegram from ripmail (read/index first).  
- Windows/Linux parity for iMessage.  
- Full parity with native clients (reactions, stickers) unless needed for search quality.

## Risks and constraints

- **Privacy:** same local-first stance as email.  
- **Maintenance:** schema + APIs drift.  
- **Legal/ToS:** frame honestly; local file read of user data vs undocumented automation.

## References

- [OPP-016 archived](../../ripmail/docs/opportunities/archive/OPP-016-multi-inbox.md) — multi-mailbox / `mailbox_id`.
- [OPP-044 archived](../../ripmail/docs/opportunities/archive/OPP-044-per-mailbox-sync-and-smtp-config.md) — IMAP sync/SMTP; orthogonal to chat connectors.
- [OPP-077](OPP-077-who-smart-address-book.md) — contacts, merge, `who`.  
- [VISION.md](../../ripmail/docs/VISION.md) — agent-first, local-first product stance.
