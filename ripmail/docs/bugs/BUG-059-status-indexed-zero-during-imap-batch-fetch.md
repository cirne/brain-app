# BUG-059: `ripmail status --json` shows zero indexed messages while sync logs steady UID fetch batches (Gmail / IMAP)

**Status:** Open  
**Severity:** High (onboarding and any UI that polls `search.indexedMessages` during first backfill)  
**Component:** IMAP sync (`src/sync/run.rs`), status (`src/status.rs`, `src/cli/commands/sync.rs`), optional: `src/db/message_persist.rs`  
**Reported:** 2026-04-19 (Braintunnel onboarding — Gmail flow; `sync.log` vs `ripmail status --json`)

---

## Summary

During a long **first backfill** (many **`Fetching batch i/n (50 message(s))…`** lines in `sync.log`), **`ripmail status --json`** continues to report **`search.indexedMessages` / `ftsReady` = 0** (and per-mailbox **`messageCount` = 0**) for an extended time. Host apps (e.g. Braintunnel onboarding) poll this and show **“0 / N messages indexed”** even while batches advance into the dozens or hundreds, so progress looks **stuck or wrong**.

This may be **(A)** a real defect (no rows reaching `messages`, or not visible to a second connection), **(B)** expected behavior that is too subtle (e.g. every message skipped as duplicate / excluded until a later phase), or **(C)** a **product gap**: **`status` has no download-phase fields**, so UIs cannot show “fetched vs persisted” even when sync is healthy.

---

## Symptom

**`sync.log` (example):**

```text
[INFO] Fetching batch 45/521 (50 message(s))…
…
[INFO] Fetching batch 76/521 (50 message(s))…
```

**While concurrently:**

```bash
ripmail status --json
```

shows **`search.indexedMessages`: `0`** (and typically **`mailboxes[].messageCount`: `0`** for the Gmail source), **`sync.isRunning`:** true (when lock semantics match).

**Downstream:** Any consumer that maps “indexed” to **`COUNT(*)` from `messages`** shows **zero** progress for a long time.

---

## Expected

At least one of:

1. **Accurate index count during sync:** After messages are persisted, **`ripmail status --json`** on a **separate process** should reflect **`COUNT(*) FROM messages`** (WAL-consistent) within normal polling intervals, unless a single long transaction blocks visibility (not observed as wrapping the whole fetch loop in `run.rs` — verify).

2. **Explicit download progress:** If index rows intentionally lag behind fetch (or fetches are not yet persisted), **`status --json`** should expose **download-phase** counters (e.g. raw RFC822 bodies fetched, current batch / total batches) so UIs do not rely solely on **`messages`** count.

---

## Reproduction notes

- **Environment:** Gmail OAuth, large mailbox, first-time **`ripmail refresh`** / backfill (backward or forward pass with many UID batches — log line format matches `src/sync/run.rs` batch loop).
- **Contrast:** Poll **`ripmail status --json`** every ~2s while tailing **`sync.log`** until batch count is ≫ 1.
- **Not yet minimized:** Single-account vs multi-mailbox `config.json`; exact `sync.defaultSince` / direction.

---

## Hypotheses (investigate in ripmail)

1. **No inserts yet:** Messages skipped by **`label_excluded`**, duplicate **`message_id`**, or similar — fetch count rises in logs but **`messages`** stays empty (would explain 0; verify with **`COUNT(*)`** and sample labels during run).

2. **Inserts occur but `status` path differs:** Wrong DB path (unlikely if same `RIPMAIL_HOME`), or parser/consumer bug in host app (verify raw JSON from **`ripmail status --json`** on the same machine).

3. **Long uncommitted write path:** Less likely if each `persist_message` auto-commits; **prove** with a test that opens a **second** `Connection` and reads **`COUNT(*)`** after each batch or after each insert in a **fake IMAP** test.

4. **UX-only gap:** Index is correct but only updates in bursts; **`status`** still needs **non-index progress** for long runs.

---

## Suggested next steps (ripmail)

1. **Regression test:** Extend or add a test under e.g. **`tests/sync_run_fake_imap.rs`** (or similar) that runs the real sync path with a fake transport, advances batches, and asserts **`get_status` / `COUNT(*) FROM messages`** (or documents intentional 0 with skip reason).

2. **Runtime probe (one failing session):** While reproducing, log **`SELECT COUNT(*) FROM messages`**, **`SELECT COUNT(*) FROM messages WHERE source_id = ?`**, and optional **`messages_fetched` / `synced`** from the sync result path — from the **same** `RIPMAIL_HOME` as **`status`**.

3. **If (4):** Add **`sync.downloadProgress`** (names TBD) to **`ripmail status --json`**, updated **once per batch** in **`run.rs`**, cleared on lock release.

---

## Related

- Similar class of issue (persistence vs counters): historical **[BUG-057](archive/BUG-057-applemail-sync-new-indexed-zero.md)** (Apple Mail; different root cause, fixed).
- Host integration: Braintunnel reads **`GET /api/onboarding/mail`** → **`ripmail status --json`** (`brain-app`).
