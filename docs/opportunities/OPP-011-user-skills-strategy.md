# OPP-011: User skills strategy (granularity & UX)

**Status:** Draft — not shipped. Complements [OPP-010: User skills](OPP-010-user-skills.md) (mechanics, seeding, UI fields). This doc answers: **how many skills**, **how coarse**, **how users invoke them**, and how that relates to the **agent toolset**.

**Product vocabulary:** We lean into **wiki** as the user-facing name for linked markdown in `WIKI_DIR`—see [Personal wiki (product)](../product/personal-wiki.md) for the mental model, onboarding copy, and why that makes `**/wiki`** a strong slash skill name.

## 1. Inventory: what the agent can already do

Skills are **not** one-to-one with tools. The toolset below is the **capability floor**; skills are **recipes and quality bars** on top. Everything listed here is available to the main chat agent without any slash command.


| Area                     | Tools (names)                                                                                                          | Typical use                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Wiki files**           | `read`, `edit`, `write`, `grep`, `find`, `move_file`, `delete_file`                                                    | Create/edit pages, search paths and content, reorganize files             |
| **Email**                | `search_email`, `read_email`, `list_inbox`, `inbox_rules`, `archive_emails`, `draft_email`, `edit_draft`, `send_draft` | Find threads, read messages, triage inbox, draft/send (send is sensitive) |
| **People**               | `find_person`                                                                                                          | Resolve contacts to wiki pages / ripmail identity                         |
| **Calendar**             | `get_calendar_events`                                                                                                  | Context for scheduling and email                                          |
| **Web / video**          | `web_search`, `fetch_page`, `get_youtube_transcript`, `youtube_search`                                                 | External research and citations                                           |
| **UI**                   | `open`, `set_chat_title`                                                                                               | Open detail panel; set conversation title                                 |
| **Local messages (WIP)** | `list_recent_messages`, `get_message_thread` (when macOS `chat.db` is available)                                       | SMS/iMessage-style threads                                                |


Onboarding and other flows may **omit** a subset of tools; the table reflects the full main agent.

**Implication:** Any skill that only says “use `grep` on the wiki” adds little—the base prompt already steers there. Skills should encode **workflow, constraints, and quality** (e.g. DRY, size budget, when to confirm send).

---

## 2. Use-case buckets (what users care about)

These are **product** categories, not slash command names yet.


| Bucket                              | Intent                                                                          | Relationship to tools                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Creating / managing content**     | New pages, edits, tone/structure passes                                         | `read` / `write` / `edit` / `grep` / `find`; web sources optional                   |
| **Maintaining the wiki as a whole** | Duplicates, orphans, tree hygiene, splits                                       | Same file tools + judgment; may touch many paths                                    |
| **Research**                        | Multi-source investigation **before** or **while** writing canonical wiki prose | `web_search`, `fetch_page`, YouTube tools, plus wiki `grep`/`read`, email as needed |
| **Finding / searching**             | “Where did I put X?” “What mentions Y?”                                         | Almost always **plain chat**—`grep`, `find`, `read`, sometimes `search_email`       |
| **Email**                           | Read, triage, draft, rules, send                                                | Ripmail-backed tools above                                                          |
| **Messages**                        | Local thread peek (WIP)                                                         | `list_recent_messages`, `get_message_thread` when enabled                           |
| **People**                          | Who is this, links to wiki + mail                                               | `find_person` + wiki pages                                                          |


**Finding/searching** often needs **no dedicated skill**: the user says what they want; the agent picks tools. A slash recipe is optional (e.g. power users who want a strict “search everything and cite sources” checklist)—not required for v1.

---

## 3. Principles (recommended)

### 3.1 Natural language first; slash = intent, not CLI

- **Primary UX:** `/skillname` followed by **free text**—goals, constraints, and scope in one utterance (e.g. “clean up this page and remove medical references”).
- **Typed templates** (`<topic>`, `[max-lines]`) are **implementation hints** and **optional power-user shorthands**, not the default contract. Defaults (e.g. line budget) live **inside** the skill body for when the user does not specify.
- `**args` in frontmatter** should read as **documentation** (“you may include topic, scope, constraints in natural language”) rather than mandatory positional parameters.

This matches how chat works and avoids “one rigid arity” for people who are not CLI natives.

### 3.2 Few domain entrypoints, not dozens of micro-commands

- **Prefer a small set of coarse skills** whose descriptions list **examples** (“draft, inbox summary, send when I confirm”).
- **Avoid** mirroring every tool name as a slash command—that duplicates discovery in the menu without adding recipe value.
- **Recommended primary name for wiki work:** `**/wiki`** — one domain entrypoint with natural-language modes inside the same skill (create page, tidy this file, prune a subtree, split oversized pages, fix links). Users say what they want in one utterance; the agent routes. Narrower built-ins (`new`, `tidy`, …) can remain as **aliases** or seeds for discoverability until metrics say otherwise.

### 3.3 Naming: three patterns (email as example)

| Pattern | Example | Pros | Cons |
| --- | --- | --- |
| **Single domain** | `/email` … “draft a note to Sam”, “what’s in my inbox” | One thing to remember; flexible | Menu line must explain breadth (description + examples) |
| **Flat verbs** | `/draft-email`, `/read-email`, `/check-email` | Very clear in picker | More entries; possible redundancy with plain chat |
| **Prefix** | `/email-draft`, `/email-inbox` | Groups on autocomplete (`email` → list) | Slightly longer slugs |

**Recommendation:** Start with **fewer top-level slugs** + **rich descriptions**; add narrower slugs only if usage shows confusion. Prefix grouping is a good **file naming** convention (`email/SKILL.md` vs many files) even if the slash stays `/email`.

### 3.4 Safety and irreversible actions

- **Email send** and **mass delete** stay **confirm-gated** in the skill text regardless of slash shape.
- **Wiki** edits can be broad; **prune**-style work under `/wiki` should **execute** safe structural fixes and **ask** for destructive steps—see [wiki/SKILL.md](../../assets/user-skills/wiki/SKILL.md).

---

## 4. Proposed skill *set* (illustrative, not final)

This is a **coarse** mapping from §2 to **candidate** skills. Count and names are for discussion; nothing is shipped.


| Domain                           | Candidate skill(s)                  | Notes                                                                                                                                                                                 |
| -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wiki (content + maintenance)** | `**wiki`** (primary)                | Umbrella: new pages, edits, tidy, prune/split, link repair—natural language specifies the job. Optional aliases: `new`, `tidy`, `prune` pointing at the same recipe or thin wrappers. |
| **Research**                     | `research`                          | Multi-source → durable wiki output; distinct from a one-line web lookup.                                                                                                              |
| **Finding**                      | *(none by default)*                 | Rely on base agent; optional `find` later if we want a strict checklist.                                                                                                              |
| **Email**                        | `email`                             | Single entry; NL covers draft / read / inbox / rules; send only after confirmation.                                                                                                   |
| **Messages**                     | `messages` or fold into chat        | WIP; small skill when tools stable.                                                                                                                                                   |
| **People**                       | *(optional)* `people` or plain chat | `find_person` + wiki; often doesn’t need a recipe unless we want a standard “enrich person page” flow.                                                                                |


**Draft** today is email-specific—either **merge into `email`** or keep as an **alias** / example in the `email` skill body so we don’t fragment “write mail.”

**Resolved for naming:** Prefer `**/wiki`** as the umbrella; rely on **NL routing** inside the skill and strong descriptions (with examples). Verb-only skills are optional aliases for users who prefer `/tidy` over “`/wiki` clean up this page.”

---

## 5. What to change in skill authoring (when we align)

- **Frontmatter:** `description` lists **modes and examples**; `args` de-emphasizes rigid templates.
- **Body:** Explicit **natural-language scope**; defaults for size/DRY; **no requirement** that the user type structured parameters.
- **Cross-links:** Skills reference each other (“if only search, use chat; if durable page, use research”) to reduce overlap.

---

## 6. Open questions

1. **Slash count:** Target **~5–8** user-facing skills vs **one per workflow verb**—where do we want to land?
2. **Aliases:** Ship `new` / `tidy` / `prune` as separate menu rows, or only as documentation examples under `/wiki`?
3. **Email:** Single `/email` in v1?
4. **Finding:** Confirm **no skill** until we see repeated confusion?
5. **People / messages:** Ship skills only when flows are stable, or ship minimal stubs with “WIP” in description?

---

## 7. References

- Product vocabulary and onboarding: [Personal wiki (product)](../product/personal-wiki.md)
- Tool implementation: `[src/server/agent/tools.ts](../../src/server/agent/tools.ts)`
- User skill seeds: `[assets/user-skills/](../../assets/user-skills/)`
- Mechanics and UI: [OPP-010](OPP-010-user-skills.md)