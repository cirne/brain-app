# Agent, chat transport, and persistence

## Stack

- **Runtime:** `@mariozechner/pi-agent-core` `Agent` with `convertToLlm` from `@mariozechner/pi-coding-agent`. **Package options, events, and metering context:** [pi-agent-stack.md](./pi-agent-stack.md) (usage / cost: [OPP-043](../opportunities/OPP-043-llm-usage-token-metering.md)).
- **Model:** `@mariozechner/pi-ai` `getModel(provider, modelId)` — provider and model from `LLM_PROVIDER` / `LLM_MODEL` (see [configuration.md](./configuration.md)).
- **Tools:** Built in `[src/server/agent/tools.ts](../../src/server/agent/tools.ts)` — see below.

Session factory: `[src/server/agent/index.ts](../../src/server/agent/index.ts)`.

## In-memory sessions

`getOrCreateSession(sessionId)` keeps a live `Agent` in a `Map`. Restart drops in-flight context; **on-disk chat files** remain.

## Chat history on disk

Completed turns are stored as **JSON documents** under `$BRAIN_HOME/chats` (see `[shared/brain-layout.json](../../shared/brain-layout.json)`). Implementation: `[chatStorage.ts](../../src/server/lib/chatStorage.ts)`.

- `GET /api/chat/sessions` — list  
- `GET /api/chat/sessions/:sessionId` — full document  
- `DELETE /api/chat/:sessionId` — remove file and evict in-memory agent

Titles can be updated early when `set_chat_title` runs (`patchSessionTitle`).

### Architectural limitations (acceptable for now)

The session list is implemented by **reading `*.json` from the chats directory**, sorting filenames by embedded `createdAtMs` so the **newest sessions come first**, then returning list rows (title, timestamps, preview derived from message text). Optional `limit` on `GET /api/chat/sessions` is **capped at 500** at the HTTP layer; omitting `limit` means the handler asks storage for an **uncapped** list (still bounded by scanning every file on disk).

There is **no server-side search**, **pagination**, or **offset** in the API. The full history UI filters **in the browser** over whatever array the client requested (e.g. up to 500 for the “all chats” view). Sessions **older than the returned window** when a limit is applied are not visible to that client until the API and storage model grow beyond directory scan + JSON files.

A future move to **per-user / app-owned SQLite** at the Node layer (same durability idea as ripmail’s mail index, but for brain-app data such as chat history and preferences) is recorded in [future-durability.md](./future-durability.md). **This is not a near-term commitment**; the file-based design is intentional and fine for current scale.

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


**Usage (LLM metering):** On each turn, the server handles `agent_end` from `@mariozechner/pi-agent-core` and sums `usage` on every `AssistantMessage` in `event.messages` (one user-visible reply can span multiple tool rounds). That aggregate is stored on the persisted **assistant** row as optional `usage` (`input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, `costTotal`). **Cached input** in provider terms corresponds to **cache read** in pi-ai (`cacheRead`).

## Agent tools (summary)

**From pi-coding-agent (wiki-scoped):** `read`, `edit`, `write`, `grep`, `find` — plus app wrappers `move_file`, `delete_file`.

**Custom (inline in `tools.ts`):** e.g. `search_index`, `read_email`, ripmail source and inbox tools, `draft_email` / `send_draft`, `find_person`, `get_calendar_events`, `web_search`, `fetch_page`, YouTube tools, `set_chat_title`, `open`, `load_skill`, and optionally `list_recent_messages` / `get_message_thread` when iMessage is available.

## Skills (slash commands and natural language)

- **Slash path:** A user message that starts with `/<slug>` (e.g. `/calendar`) is handled in `[chat.ts](../../src/server/routes/chat.ts)` by loading that skill’s `SKILL.md` and injecting it as structured user turns — not the general agent message alone.
- **Natural language (main agent):** On **new** in-memory session creation, `getOrCreateSession` appends an **Available specialized skills** block to the system prompt when `listSkills()` is non-empty (`[skillRegistry.ts](../../src/server/lib/skillRegistry.ts)`). The model can call **`load_skill`** with a `slug` to pull the same `SKILL.md` body into the turn (tool result). `POST /api/chat` runs the stream inside **[skillRequestContext.ts](../../src/server/lib/skillRequestContext.ts)** so `{{selection}}` and `{{open_file}}` placeholders match the slash path for that request.
- Onboarding and wiki-cleanup agents omit `load_skill` ([`agentToolSets.ts`](../../src/server/agent/agentToolSets.ts) omit lists).
- **`GET /api/skills`:** Lists installed skills (including a `slug` per item) for the client slash picker and discovery.

**Wiki vs indexed email/files:** separate tool families — [wiki-read-vs-read-email.md](./wiki-read-vs-read-email.md).

---

*See also: [integrations.md](./integrations.md) · [configuration.md*](./configuration.md)