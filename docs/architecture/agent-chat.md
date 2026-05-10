# Agent, chat transport, and persistence

## Stack

- **Runtime:** `@mariozechner/pi-agent-core` `Agent` with `convertToLlm` from `@mariozechner/pi-coding-agent`. **Package options, events, and metering context:** [pi-agent-stack.md](./pi-agent-stack.md) (usage / cost: [OPP-072](../opportunities/OPP-072-llm-usage-token-metering.md)).
- **Model:** `@mariozechner/pi-ai` `getModel(provider, modelId)` — `provider` and `modelId` come from **`BRAIN_LLM`** (and optional fast tier for some paths); see [configuration.md](./configuration.md).
- **Tools:** Built in `[src/server/agent/tools.ts](../../src/server/agent/tools.ts)` — see below.

Session factory: `[src/server/agent/index.ts](../../src/server/agent/index.ts)`.

## In-memory sessions

`getOrCreateSession(sessionId)` keeps a live `Agent` in a `Map`.

**Hydration:** The first time a `sessionId` is loaded in this process, the server reads persisted messages from **tenant SQLite** (if the session exists and has messages) and maps them into `initialState.messages` on the `Agent` (`[persistedChatToAgentMessages.ts](../../src/server/lib/persistedChatToAgentMessages.ts)`). That way, after a **process restart** or when the user opens a **saved chat** and sends a message, the model still sees prior user/assistant turns (including short summaries of past tool results), not only the new line. Message rows are capped (see `HYDRATION_MAX_CHAT_MESSAGES` in that file) to bound context size.

While a process is running, the in-memory `Agent` remains the source of truth for new turns; **`var/brain-tenant.sqlite`** is updated as each turn completes (`appendTurn`). Restart still **drops** any in-flight stream, but the next `getOrCreateSession` for an existing session **replays** persisted history from SQLite as above.

## Chat history on disk

Completed turns are stored in **`var/brain-tenant.sqlite`** per tenant (`files.tenantSqlite` in [`shared/brain-layout.json`](../../shared/brain-layout.json)). Implementation: [`chatStorage.ts`](../../src/server/lib/chat/chatStorage.ts) via [`tenantSqlite.ts`](../../src/server/lib/tenant/tenantSqlite.ts).

- `GET /api/chat/sessions` — list  
- `GET /api/chat/sessions/:sessionId` — full document (messages as JSON-compatible rows)  
- `DELETE /api/chat/:sessionId` — remove session (+ messages) and evict in-memory agent  

Titles can be updated early when `set_chat_title` runs (`patchSessionTitle`).

### Architectural notes

The session list reads **`chat_sessions`** ordered by **`updated_at_ms`** (newest first). Optional `limit` on `GET /api/chat/sessions` is **capped at 500** at the HTTP layer. **FTS5** over titles/previews is a documented follow-on ([chat-history-sqlite.md](./chat-history-sqlite.md)).

**Mail `notify`** items surface as **`notifications`** rows (mirrored from ripmail after refresh — see [OPP-102 stub](../opportunities/OPP-102-tenant-app-sqlite-chat-and-notifications.md)); **`GET/PATCH /api/notifications`** and agent tooling (`mark_notification`) cover list/read/dismiss.

**Unifying** chat + mail into a single SQLite file is **[OPP-103](../opportunities/OPP-103-unified-tenant-sqlite-and-ripmail-ts-port.md)** (ripmail TS port); until then, the mail index stays under **`ripmail/`**.

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