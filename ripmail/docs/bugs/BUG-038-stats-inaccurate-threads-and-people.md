# BUG-038: `ripmail stats` reports misleading thread and people counts

**Status:** Open. **Created:** 2026-04-05. **Tags:** stats, cli, data-model, agent-first

**Design lens:** [Agent-first](../VISION.md) — `ripmail stats` is a quick health snapshot for users and agents. If numbers look obviously wrong (threads equal to every message, people always zero), trust in the whole CLI degrades and agents may mis-plan work (e.g. "no contacts indexed").

---

## Summary

- **Observed:** `ripmail stats` (and `ripmail stats --json`) shows **`threads` equal to `messages`** and **`people` equal to `0`** for typical synced mailboxes.
- **Expected:** Thread count should reflect **distinct conversation threads** (or the metric should be renamed / documented if it means something else). People count should reflect **indexed contacts** or the field should be omitted / sourced from the same data `ripmail who` uses.
- **Impact:** Users and agents treat the output as ground truth; misleading counts suggest broken indexing or empty contact data when mail is actually present.

---

## Reported example

```bash
ripmail stats
```

```text
messages=1234 threads=1234 attachments=… people=0
```

(`messages` and `threads` match exactly; `people` stays at zero.)

---

## Root cause

### Threads == messages

`collect_stats` (in `src/setup.rs`) uses **`SELECT COUNT(*) FROM threads`**.

During persist (`src/db/message_persist.rs`), each new message inserts **`thread_id` = `message_id`** on the `messages` row and upserts the **`threads`** table with that same value as **`thread_id`**. There is no separate thread identifier derived from provider metadata (e.g. Gmail `X-GM-THRID`) or from stable RFC822 threading (`Message-ID` / `In-Reply-To` / `References`) at ingest time. As a result, **every message creates exactly one `threads` row**, so **`COUNT(*) FROM threads` matches `COUNT(*) FROM messages`**.

So the bug is **not** only the stats query: the underlying model currently treats each message as its own thread unless data is inserted elsewhere with a shared `thread_id`.

### People = 0

`collect_stats` uses **`SELECT COUNT(*) FROM people`**.

The **`people`** table is defined in the schema (`src/db/schema.rs`) but **nothing in the normal sync / rebuild path populates it**. Contact-oriented features (e.g. `ripmail who`) work from **`messages`** (addresses, aggregation), not from `people`. The table stays empty, so the stats line **always shows `people=0`** unless some other tool fills it.

---

## Recommendations (fix options)

1. **Stats layer (minimal):** Change `collect_stats` to report metrics that match actual behavior and user mental models, e.g. **`COUNT(DISTINCT thread_id) FROM messages`** for threads (still 1:1 until threading is fixed) and **distinct sender addresses** or a documented **“contacts inferred from messages”** query instead of `COUNT(*) FROM people` — *or* drop/rename fields until the data model is wired.
2. **Threading (correct fix):** Parse or fetch a real **`thread_id`** per message (IMAP `X-GM-THRID` where available; otherwise derive from `References` / `In-Reply-To` chains) and persist **`messages.thread_id`** and **`threads`** consistently; then stats can count distinct threads accurately.
3. **People table:** Either **populate `people`** during sync/rebuild from message-derived contacts, or **stop exposing `people`** in stats until that pipeline exists; align with whatever `who` is supposed to mean long-term.

---

## Related code (reference)

- `collect_stats` — `src/setup.rs` (`messages`, `threads`, `attachments`, `people` counts).
- Persist — `src/db/message_persist.rs` (`thread_id` / `SQL_UPSERT_THREAD`).
- Schema — `src/db/schema.rs` (`threads`, `people`).

---

## Acceptance criteria (when fixed)

- Documented definition of **thread** and **people** in stats matches implementation.
- A mailbox with multi-message threads shows **`threads` &lt; `messages`** once threading is real, or the UI explicitly states a 1:1 placeholder metric.
- **`people`** is non-zero when contact data exists **or** the field is removed/renamed so zero is not misread as “no senders in the index.”
