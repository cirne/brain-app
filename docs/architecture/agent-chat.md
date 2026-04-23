# Agent, chat transport, and persistence

## Stack

- **Runtime:** `@mariozechner/pi-agent-core` `Agent` with `convertToLlm` from `@mariozechner/pi-coding-agent`.
- **Model:** `@mariozechner/pi-ai` `getModel(provider, modelId)` — provider and model from `LLM_PROVIDER` / `LLM_MODEL` (see [configuration.md](./configuration.md)).
- **Tools:** Built in [`src/server/agent/tools.ts`](../../src/server/agent/tools.ts) — see below.

Session factory: [`src/server/agent/index.ts`](../../src/server/agent/index.ts).

## In-memory sessions

`getOrCreateSession(sessionId)` keeps a live `Agent` in a `Map`. Restart drops in-flight context; **on-disk chat files** remain.

## Chat history on disk

Completed turns are stored as **JSON documents** under `$BRAIN_HOME/chats` (see [`shared/brain-layout.json`](../../shared/brain-layout.json)). Implementation: [`chatStorage.ts`](../../src/server/lib/chatStorage.ts).

- `GET /api/chat/sessions` — list  
- `GET /api/chat/sessions/:sessionId` — full document  
- `DELETE /api/chat/:sessionId` — remove file and evict in-memory agent  

Titles can be updated early when `set_chat_title` runs (`patchSessionTitle`).

## SSE wire format (`POST /api/chat`)

Stream implementation: [`streamAgentSse.ts`](../../src/server/lib/streamAgentSse.ts). Typical events:

| Event | Purpose |
|-------|---------|
| `session` | Confirms `sessionId` |
| `text_delta` | Assistant text token deltas |
| `thinking` | Model thinking/reasoning deltas (when supported) |
| `tool_args` | Streaming args for `write` / `edit` (partial wiki updates) |
| `tool_start` | Tool invocation begins |
| `tool_end` | Tool result |
| `done` | Turn complete |
| `error` | Failure |

## Agent tools (summary)

**From pi-coding-agent (wiki-scoped):** `read`, `edit`, `write`, `grep`, `find` — plus app wrappers `move_file`, `delete_file`.

**Custom (inline in `tools.ts`):** e.g. `search_index`, `read_email`, ripmail source and inbox tools, `draft_email` / `send_draft`, `find_person`, `get_calendar_events`, `web_search`, `fetch_page`, YouTube tools, `set_chat_title`, `open`, and optionally `list_recent_messages` / `get_message_thread` when iMessage is available.

**Wiki vs indexed email/files:** separate tool families — [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md).

---

*See also: [integrations.md](./integrations.md) · [configuration.md](./configuration.md)*
