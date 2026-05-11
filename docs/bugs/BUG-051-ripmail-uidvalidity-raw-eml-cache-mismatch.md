# BUG-051: ripmail raw EML cache can mismatch DB rows after UID reuse / cache drift

**Status:** Open. **Severity:** Critical. **Tags:** ripmail, mail-cache, uidvalidity, data-integrity, ui-display

## Summary

The inbox UI can request one message by `Message-ID`, correctly resolve that message's SQLite row and headers, but then display a different email body when the UI-only display path reparses the row's cached raw `.eml` file.

Runtime debugging on 2026-05-11 confirmed the failure shape:

1. The UI requested the Geoff Cannon message ID.
2. `readMail()` resolved the Geoff DB row; route and client message ID hashes matched the request.
3. `readMailForDisplay()` opened the row's `raw_path`.
4. Parsing that raw `.eml` produced a different `Message-ID` and subject; the body was an Apple receipt.
5. The UI rendered the raw `.eml` HTML under the Geoff row's headers.

This is not a GUID collision or a false `Message-ID` match. The DB lookup was correct. The stale/corrupt pointer was `messages.raw_path`.

## Impact

- **High trust / data integrity risk:** the UI can show correct headers with another email's body.
- **Potential privacy risk:** a user may inspect or act on a body from a different message than the selected row.
- **Agent risk if reused:** the current agent read path remains text-only from `messages.body_text`, but any future agent/tool path that reparses raw `.eml` without validation could leak or ground on the wrong body.
- **Debuggability risk:** because `message_id` and headers look correct, the bug presents as "impossible" unless the raw `.eml` is parsed and compared.

## Current mitigation

`readMailForDisplay()` now validates the parsed raw `.eml` `Message-ID` against the DB row `message_id` before trusting `parsed.html` or `parsed.text`. If the IDs do not match, it falls back to stored `messages.body_text`.

That prevents the scary UI mismatch, but it is a seatbelt, not the root fix. The underlying raw cache can still drift.

## Likely root cause

Raw `.eml` files are cached by IMAP UID path:

```text
<ripmail_home>/<source_id>/<folder>/<uid>.eml
```

See:

- `writeEml()` in `src/server/ripmail/sync/maildir.ts`
- IMAP sync write call in `src/server/ripmail/sync/imap.ts`

IMAP UIDs are stable only within a mailbox epoch. When `UIDVALIDITY` changes, the same UID number may legally refer to a different message.

The current sync code detects UIDVALIDITY changes and resets incremental sync position:

```ts
if (storedState.uidvalidity !== uidvalidity) {
  lastUid = 0
}
```

But it does **not** clear or namespace the old raw files / DB rows for that `(source_id, folder, uidvalidity)` epoch. Therefore:

1. Old epoch: Geoff message is cached as `INBOX/123.eml`; DB row stores `raw_path = .../INBOX/123.eml`.
2. UIDVALIDITY changes, or another cache drift scenario causes UID assignment to reset.
3. New epoch: Apple receipt is UID `123`.
4. Sync writes Apple over `INBOX/123.eml`.
5. The old Geoff row still points at `INBOX/123.eml`.
6. UI display reparses that raw file and gets Apple HTML.

There is a second risk in `persistMessage()`:

```sql
ON CONFLICT(message_id) DO UPDATE SET
  body_text = excluded.body_text,
  subject = excluded.subject,
  synced_at = datetime('now')
```

On conflict, it does **not** update `raw_path`, `folder`, `uid`, `source_id`, labels, recipients, or other metadata. That can preserve stale raw pointers even if a later sync sees the same logical message at a new raw location.

## Repro / evidence

Observed in local Braintunnel inbox display:

- Selected message: Geoff Cannon, `Re: ' Update'`.
- Header rows rendered correctly from the Geoff DB row.
- Body rendered an Apple receipt before the display guard.
- Debug instrumentation showed:
  - route request ID hash == DB row message ID hash == client accepted response ID hash
  - parsed raw `.eml` message ID hash != DB row message ID hash
  - returned `bodyKind: "html"` came from the mismatched raw file

This confirms a raw cache / `raw_path` mismatch rather than UI selection race or route ID resolution failure.

## Recommended fix

### 1. Treat UIDVALIDITY as part of the raw cache namespace

Change raw EML cache paths to include UIDVALIDITY, for example:

```text
<ripmail_home>/<source_id>/<folder>/<uidvalidity>/<uid>.eml
```

or use a Message-ID-derived content path:

```text
<ripmail_home>/<source_id>/messages/<safe-message-id>.eml
```

UIDVALIDITY in the path is closest to IMAP semantics. Message-ID paths reduce UID epoch risk but need collision/normalization handling.

### 2. On UIDVALIDITY change, clear or quarantine old folder state

When `storedState.uidvalidity !== uidvalidity`, do more than `lastUid = 0`:

- Delete or mark stale rows for the affected `source_id + folder` epoch.
- Remove or quarantine the old raw cache for that folder epoch.
- Rebuild rows from the new epoch cleanly.

Because the app is pre-productization and local data can be reset, prefer a clean break over compatibility migration complexity.

### 3. Update DB rows on conflict

Update `persistMessage()` so conflict updates include at least:

- `raw_path`
- `folder`
- `uid`
- `labels`
- `category`
- sender / recipient fields
- `date`
- `source_id`
- reply/list metadata once parity is in this path

If the same logical `Message-ID` is seen again, the DB row should point at the freshest raw file that produced the current body text.

### 4. Keep raw Message-ID validation as an invariant

Even after fixing cache paths, keep the display guard:

- Parse raw `.eml`.
- Compare parsed `Message-ID` to DB `message_id`.
- If mismatch: never use raw body; log/diagnose and fall back to indexed text.

This catches future corruption and stale cache bugs before they become cross-message display bugs.

### 5. Add regression tests

Add tests for:

- UIDVALIDITY change creates isolated raw paths or clears old cache.
- Reusing UID after UIDVALIDITY change cannot make an old DB row read a new raw body.
- `persistMessage()` conflict updates `raw_path`.
- `readMailForDisplay()` refuses mismatched raw `.eml` Message-ID and falls back to `body_text`.

## Acceptance criteria

- A raw `.eml` file for one message can never be trusted for another message without a `Message-ID` match.
- UID reuse after UIDVALIDITY change cannot overwrite raw files that existing rows still reference.
- Conflict upserts do not preserve stale raw pointers.
- Inbox UI display and any future UI display route render either matching raw MIME content or stored text fallback, never mismatched raw HTML.

## Related code

- `src/server/ripmail/sync/imap.ts`
- `src/server/ripmail/sync/maildir.ts`
- `src/server/ripmail/sync/persist.ts`
- `src/server/ripmail/mailRead.ts`
- `src/server/routes/inbox.ts`
