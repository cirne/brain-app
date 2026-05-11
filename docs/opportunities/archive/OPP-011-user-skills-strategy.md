# Archived: OPP-011 (User Skills Strategy)

**Status: Deprioritized — archived.** Companion to [archived OPP-010](./OPP-010-user-skills.md). The strategy and naming analysis here remains valid whenever slash commands are built; archived with OPP-010 since the mechanism and the strategy ship together.

**Key decisions captured here (for when we return):**
- `/wiki` as the single umbrella skill for all wiki operations (NL routing inside)
- `/research` for multi-source → durable wiki output
- `/email` as the single email entrypoint (draft + read + inbox + rules)
- Natural language first; slash = intent, not CLI
- ~5-8 user-facing skills max; no micro-commands mirroring every tool
- Confirm-gated for send and destructive wiki operations

---

# OPP-011: User skills strategy (granularity & UX)

**Status:** Draft — not shipped. Complements [OPP-010: User skills](OPP-010-user-skills.md) (mechanics, seeding, UI fields). This doc answers: **how many skills**, **how coarse**, **how users invoke them**, and how that relates to the **agent toolset**.

## 1. Inventory: what the agent can already do

| Area | Tools (names) | Typical use |
| --- | --- | --- |
| **Wiki files** | `read`, `edit`, `write`, `grep`, `find`, `move_file`, `delete_file` | Create/edit pages, search paths and content, reorganize files |
| **Email** | `search_email`, `read_mail_message`, `read_indexed_file`, `list_inbox`, `inbox_rules`, `archive_emails`, `draft_email`, `edit_draft`, `send_draft` | Find threads, read messages, triage inbox, draft/send (send is sensitive) |
| **People** | `find_person` | Resolve contacts to wiki pages / ripmail identity |
| **Calendar** | `get_calendar_events` | Context for scheduling and email |
| **Web / video** | `web_search`, `fetch_page`, `get_youtube_transcript`, `youtube_search` | External research and citations |
| **UI** | `open`, `set_chat_title` | Open detail panel; set conversation title |
| **Local messages** | `list_recent_messages`, `get_message_thread` | SMS/iMessage-style threads |

## 2. Use-case buckets

| Bucket | Intent | Relationship to tools |
| --- | --- | --- |
| **Creating / managing content** | New pages, edits, tone/structure passes | `read` / `write` / `edit` / `grep` / `find` |
| **Maintaining the wiki** | Duplicates, orphans, tree hygiene, splits | Same file tools + judgment |
| **Research** | Multi-source investigation before/while writing | `web_search`, `fetch_page`, YouTube tools, wiki `grep`/`read`, email |
| **Finding / searching** | "Where did I put X?" | Almost always plain chat |
| **Email** | Read, triage, draft, rules, send | Ripmail-backed tools |
| **Messages** | Local thread peek | `list_recent_messages`, `get_message_thread` |
| **People** | Who is this, links to wiki + mail | `find_person` + wiki pages |

## 3. Principles

### 3.1 Natural language first; slash = intent, not CLI

Primary UX: `/skillname` followed by free text. Typed templates are optional power-user shorthands.

### 3.2 Few domain entrypoints, not dozens of micro-commands

- Prefer a small set of coarse skills whose descriptions list examples
- Recommended primary name for wiki work: `/wiki` — one domain entrypoint with NL routing inside

### 3.3 Safety and irreversible actions

- **Email send** and **mass delete** stay confirm-gated
- **Wiki** prune-style work should execute safe structural fixes and ask for destructive steps

## 4. Proposed skill set

| Domain | Candidate skill(s) | Notes |
| --- | --- | --- |
| **Wiki** | `wiki` (primary) | Umbrella: NL specifies the job |
| **Research** | `research` | Multi-source → durable wiki output |
| **Finding** | *(none by default)* | Rely on base agent |
| **Email** | `email` | Single entry; NL covers all modes; send after confirmation |
| **Messages** | `messages` or fold into chat | WIP; small skill when tools stable |
| **People** | *(optional)* | `find_person` + wiki; often doesn't need a recipe |

## 5. References

- Tool implementation: `[src/server/agent/tools.ts](../../../src/server/agent/tools.ts)`
- User skill seeds: `[assets/user-skills/](../../assets/user-skills/)`
- Mechanics and UI: [OPP-010](OPP-010-user-skills.md)
