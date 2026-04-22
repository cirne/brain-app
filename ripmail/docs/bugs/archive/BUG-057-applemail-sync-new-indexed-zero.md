# BUG-057: Apple Mail sync reports `new_indexed=0` despite processing messages

**Status:** Fixed (2026-04-15)  
**Severity:** High (historical)  
**Component:** `src/applemail/sync.rs`, `src/db/message_persist.rs`  
**Related:** [OPP-050](../opportunities/OPP-050-applemail-localhost-mailbox.md) (Apple Mail localhost mailbox)

## Summary (historical)

Apple Mail sync (`ripmail refresh --mailbox applemail --since 30d`) read `.emlx` files and ran the pipeline, but `new_indexed` stayed 0 and the DB did not gain rows as expected.

## Fix (shipped 2026-04-15)

- **`persist_message`:** Use `INSERT` into `messages` and treat SQLite **unique** violations on `message_id` as `Ok(false)` (duplicate). Non-duplicate errors propagate instead of being swallowed by `INSERT OR IGNORE` with `n == 0`.
- **Apple Mail dedup:** Batched `uids_already_indexed` (correct `IN` placeholder binding) so already-indexed UIDs are skipped before reading `.emlx`, consistent with sync counters.

See `src/db/message_persist.rs` (`persist_message`, `uids_already_indexed`) and `src/applemail/sync.rs`.

## Symptom (historical)

```
ripmail: applemail: finished: new_indexed=0 global_rows_scanned=4191 ...
```

## Theories tested (historical)

Earlier investigation covered schema/`user_version`, `.emlx` path resolution (`ROWID` stems, `imap://` URLs, `.partial.emlx`), SQL date filtering, and removal of a flawed early-stop heuristic. The remaining gap was persistence semantics and UID dedup correctness.

## Related

- Transcript (investigation context): [Apple Mail sync debugging](376bab9e-4abe-42f0-ba9c-eb727d9a0b05)
