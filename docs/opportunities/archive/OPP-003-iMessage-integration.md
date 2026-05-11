# Archived: OPP-003 (iMessage Integration)

**Status: Done enough — archived.** The core iMessage tools (`list_recent_messages`, `get_message_thread`) are implemented and available in the main agent tool set. The wiki-driven correlation pattern (resolve person → get phone/handle → call thread tool) works as designed. This opportunity is closed; new work can open fresh OPPs targeting specific improvements (e.g. unread-semantics reliability, a Messages UI pane, or handle normalization).

**What shipped:**
- `list_recent_messages` — recent messages across all chats, filterable by time window and unread status
- `get_message_thread` — retrieve messages in a conversation by chat identifier
- Agent-level cross-source correlation: wiki people pages → phone/handle → iMessage threads
- macOS-only, read-only, Full Disk Access required (documented)

**What was deferred (open for future OPPs if needed):**
- Dedicated Messages UI pane (today it is agent-only)
- Centralized handle normalization module
- CI fixture SQLite for testing without a real `chat.db`
- Unread semantics reliability across macOS versions

---

# OPP-003: iMessage Integration (local Messages DB)

**Related:** Inbox/email is covered by ripmail and existing agent tools. This opportunity is a **parallel channel**: short-form, high-frequency SMS/iMessage threads that rarely live in email and are not indexed elsewhere in brain-app today.

## The idea

On macOS, the Messages app stores conversation history in a local SQLite database (`~/Library/Messages/chat.db`). Read-only access to that database (with user consent and OS permissions) lets the agent answer questions that depend on *what was said in iMessage* — the same way it already answers from wiki and email.

Integration is **local-first**: tools run on the machine where Messages is authoritative. No Apple API, no cloud sync requirement for the feature to work. The agent correlates wiki people-pages (phone numbers, handles) with `chat.db` rows so queries are natural: "What did Brett text?" not "SELECT FROM message WHERE …".

---

## Proposed tools (read-only)

All tools assume a configured path to the chat database (default: standard macOS location) and **read-only** SQLite connections.

### `list_recent_messages` (implemented; was scoped as "iMessage" in early drafts)

Return recent messages across all chats or filtered scope.

| Parameter | Purpose |
|-----------|---------|
| `since` / `until` | Time window (ISO timestamps or relative e.g. `7d`) |
| `unread_only` | If true, restrict to messages the DB still marks unread (when that metadata is reliable for the query) |
| `limit` | Cap rows returned (default conservative) |

### `get_message_thread` (implemented)

Resolve a **thread** (conversation) and return messages in order.

| Parameter | Purpose |
|-----------|---------|
| `chat_identifier` | Stable id from DB (or derived from phone/email handle after resolution) |
| `since` / `until` | Optional time window on messages within the thread |
| `limit` | Max messages (newest-first or chronological — pick one convention and document it) |

Optional convenience: `message_count` in the response (or a separate light query) so the agent can say "42 messages in the last month" without pulling full bodies.

### Correlation helpers (agent-level, not necessarily separate tools)

The **agent** performs cross-source correlation using existing primitives:

1. Resolve **who** from the wiki — e.g. open Brett's person page, read phone number(s), Apple IDs, or labeled handles.
2. Normalize **handles** to the forms stored in `chat.db` (phone formats, `chat_identifier` conventions).
3. Call `get_message_thread` / `list_recent_messages` with those handles.

No requirement for a magic "Brett → thread" tool if the agent can already `read` the wiki and pass structured identifiers into iMessage tools.

---

## Core workflows

### 1. Recent activity

**User:** "Summarize my unread texts from the last 24 hours."

Agent calls `list_recent_messages` with `unread_only: true` and a one-day window, then synthesizes a short summary (and optionally uses `open` to show a thread in the UI if such a hook exists later).

### 2. Thread depth and recency

**User:** "How active was my thread with Alex this week?"

Agent resolves Alex's chat (from wiki or from a prior search), uses `get_message_thread` with a 7-day window, reports **message count** and last-activity time from tool metadata or message list.

### 3. Person-centric question (wiki + iMessage + email)

**User:** "What have I heard from Brett lately?"

1. **Find Brett in the wiki** — search or open `people/brett` (or equivalent); extract phone, email, nicknames.
2. **SMS / iMessage** — map phone/handle → thread; `get_message_thread` with a reasonable default window (e.g. 30 days) or `list_recent_messages` filtered by resolved identifiers.
3. **Email** — existing ripmail / `search_email` / `read_mail_message` using addresses from the same page.
4. **Synthesize** — one answer that cites channel (SMS vs Mail) and time, without duplicating raw dumps unless asked.

This is the same **correlation pattern** as calendar + email: structured identity in the wiki, multiple backends queried by the agent.

---

## Platform and permissions

- **macOS only** for native `chat.db` access. Other platforms would need different backends or explicit non-goals.
- **Full Disk Access** (or equivalent) is typically required for processes to read `~/Library/Messages/chat.db`; document this in setup and fail with a clear error if the file is unreadable.
- **Privacy:** read-only tools; no sending or editing messages in v1. Sending would be a separate product/security discussion.
- **Schema stability:** Apple can change internal DB layout between OS releases; tools should isolate SQL and version-detect or pin supported macOS versions in docs.

---

## Productization notes

- **Single-user brain** (today): one user, one machine — straightforward.
- **Multi-user / hosted brain** ([docs/PRODUCTIZATION.md](../../PRODUCTIZATION.md)): iMessage data does not belong on a shared server; any hosted offering would either omit this feature or require a local relay the user runs — same class of problem as "your mail lives on your laptop."

---

## Open questions

1. **Unread semantics:** How reliably does `chat.db` reflect "unread" across macOS versions and iCloud message sync? May need to treat `unread_only` as best-effort.
2. **Handle normalization:** Centralize phone/email formatting in one small module shared by tool implementation and tests.
3. **UI:** Does the client get a Messages pane (like Inbox), or is iMessage agent-only until a later milestone?
4. **Testing:** CI cannot mount a real `chat.db`; use fixture SQLite files with minimal schema compatible with the queries the app uses.

---

## Summary

Local read-only iMessage tools plus wiki-driven correlation give the agent a third leg of "what happened with this person?" alongside wiki and email, with Brett-style questions as the flagship user story.
