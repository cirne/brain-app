# Agent, chat transport, and persistence

## Stack

- **Runtime:** `@mariozechner/pi-agent-core` `Agent` with `convertToLlm` from `@mariozechner/pi-coding-agent`. **Package options, events, and metering context:** [pi-agent-stack.md](./pi-agent-stack.md) (usage / cost: [OPP-072](../opportunities/OPP-072-llm-usage-token-metering.md)).
- **Model:** `@mariozechner/pi-ai` `getModel(provider, modelId)` — `provider` and `modelId` come from **`BRAIN_LLM`** (and optional fast tier for some paths); see [configuration.md](./configuration.md).
- **Tools:** Built in `[src/server/agent/tools.ts](../../src/server/agent/tools.ts)` — see below.

Session factory: `[src/server/agent/index.ts](../../src/server/agent/index.ts)`.

## In-memory sessions

`getOrCreateSession(sessionId)` keeps a live `Agent` in a `Map`.

**Hydration:** The first time a `sessionId` is loaded in this process, the server reads the matching JSON from disk (if it exists and has messages) and maps it into `initialState.messages` on the `Agent` (`[persistedChatToAgentMessages.ts](../../src/server/lib/persistedChatToAgentMessages.ts)`). That way, after a **process restart** or when the user opens a **saved chat** and sends a message, the model still sees prior user/assistant turns (including short summaries of past tool results), not only the new line. Message rows are capped (see `HYDRATION_MAX_CHAT_MESSAGES` in that file) to bound context size.

While a process is running, the in-memory `Agent` remains the source of truth for new turns; disk is updated as each turn completes (`appendTurn`). Restart still **drops** any in-flight stream, but the next `getOrCreateSession` for an existing session **replays** persisted history from disk as above.

## Chat history on disk

Completed turns are stored as **JSON documents** under `$BRAIN_HOME/chats` (see `[shared/brain-layout.json](../../shared/brain-layout.json)`). Implementation: `[chatStorage.ts](../../src/server/lib/chatStorage.ts)`.

- `GET /api/chat/sessions` — list  
- `GET /api/chat/sessions/:sessionId` — full document  
- `DELETE /api/chat/:sessionId` — remove file and evict in-memory agent

Titles can be updated early when `set_chat_title` runs (`patchSessionTitle`).

### Architectural limitations (acceptable for now)

The session list is implemented by **reading `*.json` from the chats directory**, sorting filenames by embedded `createdAtMs` so the **newest sessions come first**, then returning list rows (title, timestamps, preview derived from message text). Optional `limit` on `GET /api/chat/sessions` is **capped at 500** at the HTTP layer; omitting `limit` means the handler asks storage for an **uncapped** list (still bounded by scanning every file on disk).

There is **no server-side search**, **pagination**, or **offset** in the API. The full history UI filters **in the browser** over whatever array the client requested (e.g. up to 500 for the “all chats” view). Sessions **older than the returned window** when a limit is applied are not visible to that client until the API and storage model grow beyond directory scan + JSON files.

A move to **per-user / app-owned SQLite** at the Node layer (same pattern as ripmail’s mail index, but for brain-app data: chat history, preferences, nav recents) is detailed in [chat-history-sqlite.md](./chat-history-sqlite.md). The file-based design is acceptable at current scale; the schema is stable enough to migrate cleanly whenever prioritized.

## SSE wire format (`POST /api/chat`)

Stream implementation: `[streamAgentSse.ts](../../src/server/lib/streamAgentSse.ts)`. Typical events:


| Event        | Purpose                                                    |
| ------------ | ---------------------------------------------------------- |
| `session`    | Confirms `sessionId`                                       |
| `text_delta` | Assistant text token deltas                                |
| `thinking`   | Model thinking/reasoning deltas (when supported)           |
| `tool_args`  | Streaming args for `write` / `edit` (partial wiki updates) |
| `tool_start` | Tool invocation begins                                     |
| `tool_end`   | Tool result                                                |
| `done`       | Turn complete                                              |
| `error`      | Failure                                                    |

## Quick replies (suggestion chips)

Tappable follow-ups use the **`suggest_reply_options`** tool and an optional **repair** completion when the model omits chips. **Main chat** and **guided onboarding interview** share the same pipeline (no separate “suggestions JSON” HTTP API). Details, env toggles, and client behavior: **[chat-suggestions.md](./chat-suggestions.md)**.


**Usage (LLM metering):** On each turn, the server handles `agent_end` from `@mariozechner/pi-agent-core` and sums `usage` on every `AssistantMessage` in `event.messages` (one user-visible reply can span multiple tool rounds). That aggregate is stored on the persisted **assistant** row as optional `usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `costTotal`). **Cached input** in provider terms corresponds to **cache read** in pi-ai (`cacheRead`).

## Agent tools (summary)

**From pi-coding-agent (wiki-scoped):** `read`, `edit`, `write`, `grep`, `find` — plus app wrappers `move_file`, `delete_file`.

**Custom (inline in `tools.ts`):** e.g. `search_index`, `read_mail_message`, `read_indexed_file`, ripmail source and inbox tools, `draft_email` / `send_draft`, `find_person`, `get_calendar_events`, `web_search`, `fetch_page`, YouTube tools, `set_chat_title`, `open`, `load_skill`, **`suggest_reply_options`** (quick-reply chips; see [chat-suggestions.md](./chat-suggestions.md)), and optionally `list_recent_messages` / `get_message_thread` when iMessage is available.

## Skills (slash commands and natural language)

- **Slash path:** A user message that starts with `/<slug>` (e.g. `/calendar`) is handled in `[chat.ts](../../src/server/routes/chat.ts)` by loading that skill’s `SKILL.md` and injecting it as structured user turns — not the general agent message alone.
- **Natural language (main agent):** On **new** in-memory session creation, `getOrCreateSession` appends an **Available specialized skills** block to the system prompt when `listSkills()` is non-empty (`[skillRegistry.ts](../../src/server/lib/skillRegistry.ts)`). The model can call **`load_skill`** with a `slug` to pull the same `SKILL.md` body into the turn (tool result). `POST /api/chat` runs the stream inside **[skillRequestContext.ts](../../src/server/lib/skillRequestContext.ts)** so `{{selection}}` and `{{open_file}}` placeholders match the slash path for that request.
- Onboarding and wiki-cleanup agents omit `load_skill` ([`agentToolSets.ts`](../../src/server/agent/agentToolSets.ts) omit lists).
- **`GET /api/skills`:** Lists installed skills (including a `slug` per item) for the client slash picker and discovery.

**Wiki vs indexed email/files:** separate tool families — [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md).

---

*See also: [integrations.md](./integrations.md) · [configuration.md*](./configuration.md)