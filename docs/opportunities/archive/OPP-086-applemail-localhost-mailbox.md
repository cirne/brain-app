# Archived: OPP-086 — Apple Mail localhost mailbox

**Status: Archived (2026-05-11).** In-tree MVP shipped; tracking closed. Residual polish can be new work if needed.


---

## Original spec (historical)

### OPP-086: Apple Mail Localhost Mailbox — Local Index Without IMAP

**Former ripmail id:** OPP-050 (unified backlog 2026-05-01).

**Status:** Active — **MVP shipped in-tree** (`mailboxType: "applemail"`). Index + FTS query path works for day-to-day use; wizard polish and incremental sync remain future work.

**Created:** 2026-04-15.

## Current status (2026-04)

**Working today**

- **Config:** Per-mailbox `mailboxType` / `appleMailPath` (optional; defaults to latest `~/Library/Mail/V*`). Coexists with IMAP mailboxes; shared DB is `~/.ripmail/ripmail.db` in multi-inbox layout.
- **Indexing:** `ripmail refresh --foreground --mailbox <id|email> --since <spec>` walks Apple’s `Envelope Index` + resolves `{remote_id}.emlx` (not SQLite `ROWID`), parses `.emlx` (including space-padded length lines), persists into the normal `messages` / FTS5 pipeline with folder label `**Apple Mail`**.
- **Query:** `ripmail search … --mailbox applemail` (and `read`, etc.) use the same primitives as IMAP-backed mail; results include `mailboxId` for the Apple Mail account.

**Tradeoffs / caveats (known)**

- **Local bodies only:** Recent envelope rows may have **no** on-disk `.emlx` (e.g. not downloaded yet); those rows are skipped until Mail stores the file. Partial downloads (`.partial.emlx`) are indexed when present.
- **Full table scan:** Sync scans the entire Envelope Index (~23ms per 1000 rows envelope-only; ~73s for 253k rows including indexing). No early-stop heuristic—ROWID order doesn't correlate with date, so we scan everything and filter by `--since`.
- **Still to build:** Wizard entry for Apple Mail, true incremental sync (mtimes / deltas), richer deletion handling, attachment edge cases.

## Summary

Add a new mailbox type `**applemail`** (localhost) that reads directly from the local Apple Mail SQLite database instead of syncing over IMAP. ripmail builds its canonical index (FTS5, same schema) by reading Apple Mail's local data store. This enables **buttery smooth onboarding for Mac users** — no IMAP credentials, no app passwords, no OAuth — just grant Full Disk Access and ripmail indexes your mail.

## Problem

- Setting up IMAP credentials is the biggest friction point for new users: Gmail requires app passwords or OAuth, other providers vary.
- Mac users running Apple Mail already have **all their mail synced locally** — ripmail re-syncs the same data over the network.
- Users on slow or metered connections pay twice: once for Apple Mail, once for ripmail.
- The current onboarding flow requires environment variables, credentials, and validation — not "buttery smooth."

## Opportunity

Apple Mail stores its data locally under `~/Library/Mail/` with metadata in SQLite databases (e.g., `Envelope Index`). ripmail could read this directly:

1. **Zero-credential onboarding:** User grants Full Disk Access, ripmail discovers mailboxes, indexes them.
2. **No network sync:** Index builds from local files — fast, works offline, no IMAP connection needed.
3. **Familiar semantics:** Apple Mail users see the same mailboxes, folders, and structure they already know.
4. **Complement to IMAP:** Not a replacement — users can mix `applemail` localhost mailboxes with traditional IMAP mailboxes.

## Design questions

### 1. Content storage: reference vs copy

Two options for reading message bodies:


| Approach                                                    | Pros                                                               | Cons                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Reference** Apple Mail's `.emlx` files                    | No duplication; always reads current state; smaller `~/.ripmail`   | Fragile if Apple Mail moves/renames files; read path more complex; Apple Mail's file layout changes across versions |
| **Copy** bodies into ripmail's data dir (like IMAP maildir) | Consistent with existing architecture; survives Apple Mail changes | Duplicates storage; initial sync slower                                                                             |


**Likely direction:** Start with **reference** for exploration, fall back to **copy** if Apple Mail's file layout proves unstable. The index (SQLite metadata + FTS) always lives in ripmail's DB regardless.

### 2. What to index vs what to reference

- **Index (always in ripmail SQLite):** Message-ID, date, from, to, cc, subject, FTS body text, thread references, attachments metadata.
- **Reference (read on demand):** Full body, raw headers, attachment bytes — read from Apple Mail's `.emlx` files at `read` time.

This matches how ripmail's IMAP maildir works: index lives in SQLite, maildir files hold raw content.

### 3. Apple Mail data layout

Apple Mail stores data under `~/Library/Mail/V*/`:

- `**Envelope Index`** SQLite database — message metadata, folder structure.
- `**.mbox/` directories** — per-mailbox folders containing `.emlx` files (single-message format with Apple preamble).
- **WAL files** — same snapshot story as iMessage.

**Permissions:** Full Disk Access required (same as iMessage connector).

**Schema stability:** Not documented by Apple; expect maintenance across macOS versions. Less volatile than `chat.db` but not a contract.

### 4. Mailbox discovery and config

New config structure:

```json
{
  "mailboxes": [
    {
      "id": "icloud-user",
      "type": "applemail",
      "appleMailPath": "~/Library/Mail/V10/...",
      "email": "user@icloud.com"
    },
    {
      "id": "work-gmail",
      "type": "imap",
      "email": "user@company.com",
      "imap": { ... }
    }
  ]
}
```

`ripmail wizard` would offer "Apple Mail (local)" as a mailbox type, auto-discover accounts from the Envelope Index, and prompt for which to enable.

### 5. Sync semantics

- **No network sync:** `ripmail refresh` for an `applemail` mailbox scans local files, not IMAP.
- **Incremental:** Track mtime or Apple Mail's internal sequence numbers; only process changed/new messages.
- **Deletions:** Detect removed messages and mark as deleted in ripmail's index (or purge, per policy).

## Onboarding UX (ideal)

```
$ ripmail wizard
? Choose mailbox type:
  > Apple Mail (local) — fastest, no passwords needed
    IMAP (enter credentials)
    Gmail (Sign in with Google)

? Found 2 Apple Mail accounts. Select which to index:
  [x] user@icloud.com
  [ ] old-account@gmail.com

? Grant Full Disk Access to Terminal (required):
  → System Settings → Privacy & Security → Full Disk Access → Terminal
  Press enter when done...

✓ Indexing user@icloud.com... 12,847 messages indexed.
✓ ripmail is ready. Try: ripmail search "flight confirmation"
```

## Technical feasibility


| Topic                | Notes                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| **Data location**    | `~/Library/Mail/V*/`, version suffix increments with macOS updates.            |
| **Access**           | Read-only file access; WAL snapshot for consistency.                           |
| **Permissions**      | Full Disk Access for the host process.                                         |
| **Schema stability** | Not documented; changes across macOS versions; connector maintenance required. |
| **Distribution**     | Feasible for unsandboxed CLI; App Store sandbox incompatible.                  |
| **.emlx format**     | Apple's single-message format with preamble line (byte count); parseable.      |


## Non-goals (initial)

- **Writing to Apple Mail** — read-only index; compose/send uses SMTP as today.
- **iOS Mail** — desktop only; iOS doesn't expose the same filesystem.
- **Real-time sync** — batch refresh, not live watching (future: fsevents if valuable).
- **Full Apple Mail feature parity** — rules, VIPs, smart mailboxes are Apple-side; ripmail indexes the canonical message store.

## Risks

- **Apple changes the layout:** Schema or file structure changes break the connector. Mitigation: version detection, graceful fallback, maintenance budget.
- **Permissions friction:** Full Disk Access is a high-trust grant. Mitigation: clear explanation, wizard guidance, optional (user can always use IMAP).
- **Incomplete data:** Apple Mail may store some data in formats harder to parse (e.g., rich text notes, encrypted messages). Mitigation: index what's parseable, skip gracefully.

## Related

- [OPP-083](./OPP-083-imessage-and-unified-messaging-index.md) — iMessage + unified messaging; same FDA story, different data source.
- [OPP-016 archived](../../ripmail/docs/opportunities/archive/OPP-016-multi-inbox.md) — multi-mailbox architecture this would extend.
- [OPP-009 archived](../../ripmail/docs/opportunities/archive/OPP-009-agent-friendly-setup.md) — wizard UX patterns.

