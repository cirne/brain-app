# OPP-037: Messages — long-term indexing, search, and unified people

**Status:** Active (directional; not committed roadmap).

## Summary

Email in Brain is **indexed** by ripmail into a compact SQLite corpus under the user’s mail home: enough text and metadata to search, thread, and cite mail **without** mirroring the full remote mailbox (and certainly not every attachment). Local **SMS/iMessage** is different: conversations are **thread-centric**, high-churn, and the authoritative store (`chat.db`) is **Apple’s**, read-only to us. Today the agent uses **live queries** (`list_recent_messages`, `get_message_thread`) with a **recency-biased** window—good for “what did X text lately?” but weak for **full history search**, **canonical cross-channel context**, and **fast** retrieval at scale.

This OPP proposes the **long-term play**: treat message **text** (not media blobs) as an optional **Brain-owned incremental index**—analogous in spirit to ripmail’s mail index—while **unifying identity** across mail handles, wiki people pages, and message identifiers so “find person → see email + texts” is first-class. Avoid copying **attachments** (photos, videos, large files) into Brain’s store by default; size stays manageable if we index **body text + thread metadata + stable ids** only.

## Why not “only `chat.db` forever”?

Direct SQLite access is the right **source of truth** for freshness, but it has limits for product-level features:

- **Search:** Full-text and ranked search across years of history is awkward if every query is an ad hoc scan of Apple’s schema; FTS and our own doc IDs are easier to evolve on **our** side.
- **Context windows:** The agent needs **snippets** and **thread summaries** tied to stable identifiers; an index can store derived fields (last-seen, participant sets) without re-reading huge joins every time.
- **Canonical “person” view:** `chat.db` knows **handles**; the user knows **people**. We already correlate wiki **Contact / Identifiers** sections and mail via **`find_person`** / **`ripmail who`** patterns. Messages should **ride the same rail**: a **directory of people and identifiers** (email, phone, Apple IDs) that links threads across channels—without requiring a perfect global graph on day one.

Relying **exclusively** on live queries also couples feature quality to **permissions**, **path**, and **schema** stability in one place; a thin replicated text index **decouples** search UX from “whatever Apple put in this macOS version.”

## Parallels with ripmail (and where they diverge)

| Aspect | Ripmail / indexed mail | Local messages |
|--------|-------------------------|----------------|
| Authority | Remote IMAP + local index | **`chat.db`** (read-only) |
| What we store | Text + headers + paths; not a full mirror of Gmail | Should be **text + metadata**; **not** a full mirror of Photos-in-texts |
| Unit of retrieval | Message / thread (mail semantics) | **Chat thread** + ordered messages |
| Identity | Addresses, Message-IDs | Phone, email handle, group id |

The **analogy** holds: **index for search and synthesis**, **don’t fork the entire corpus**. The **difference** is we are not syncing from a protocol we control—we **incrementally ingest** from a local DB or change log (implementation detail TBD) into **`BRAIN_HOME`**.

## Design goals

1. **Search:** Regex / structured search over **message bodies** (and thread metadata), similar in *feel* to `search_index` for mail—possibly unified under ripmail’s evolving query story ([ripmail OPP-052](../ripmail/docs/opportunities/OPP-052-search-query-language-regex-metadata-flags.md)).
2. **Bounded disk:** Default index is **text-only**; exclude or optionally lazy-fetch **attachments** so we do not balloon to tens of GB.
3. **Thread fidelity:** Preserve **chat_identifier**, participants, timestamps, read flags where useful—enough to rebuild **conversation context** for the agent and UI.
4. **Unified people:** Reuse and extend **identifier resolution** (wiki contacts, `find_person`, ripmail’s address book direction) so phone ↔ person ↔ email is a **best-effort join**, not three silos.
5. **Local-first:** Same trust model as today: data stays on device; index is **derived**, disposable, rebuildable.

## Proposed architecture (sketch)

**A. Incremental text index (Brain-owned SQLite or ripmail-adjacent store)**

- **Source:** Read-only pass over `chat.db` (or event-driven refresh when Brain runs). Store: `message_rowid` or stable id, `chat_identifier`, `text`, `timestamp`, `is_from_me`, optional **denormalized** thread summary fields.
- **Exclude:** Attachment **payloads** by default; optionally record **placeholders** (`has_attachment`, filename, uti) for UI without storing bytes.
- **Rebuild:** If schema shifts or corruption—delete index dir and re-ingest (early-dev stance: no elaborate migrations; see [AGENTS.md](../../AGENTS.md)).

**B. Unified people / handles directory (cross-cutting)**

- **Inputs:** Ripmail `who` / account identities, wiki `people/*.md` Contact blocks, message **chat_identifier** graph.
- **Output:** A small **resolved** map: “this person” → { emails, phones, Apple IDs, linked wiki paths } with **provenance** and **confidence** (heuristic merges, user overrides in wiki win).
- **Not required upfront:** A perfect “CRM”—start with **deterministic** joins (exact phone match, wiki-listed identifiers) and expand.

**C. Agent and API surface**

- Evolve from **recency-only tools** toward **`search_messages`** (or unified `search_index` with `source: messages`) + **`get_message_thread`** unchanged as the drill-down.
- **Optional:** Background **summaries** per thread (stored in wiki or sidecar) for “what have we talked about with X?”—separate OPP if it grows large.

## What to defer

- **Full attachment indexing** (OCR on images, video frames)—high cost, privacy surface, storage.
- **Cloud relay** of message content—contradicts local-first unless explicitly user-opt-in.
- **Replacing** live `chat.db` reads for **latest** messages: the index should be **eventually consistent**; hot paths may still hit **`chat.db`** for “right now.”

## Relationship to existing work

- **Shipped baseline:** [archived OPP-003](archive/OPP-003-iMessage-integration.md) — tools on live DB + wiki correlation.
- **Mail / unified sources:** [ripmail OPP-051](../ripmail/docs/opportunities/OPP-051-unified-sources-mail-local-files-future-connectors.md), search language [OPP-052](../ripmail/docs/opportunities/OPP-052-search-query-language-regex-metadata-flags.md).
- **Brain layout / where data lives:** [OPP-012](OPP-012-brain-home-data-layout.md).

## Open questions

- Should the message text index live **inside ripmail’s SQLite universe** (one query interface for “all local sources”) or a **dedicated** `messages/` store under `BRAIN_HOME` with a thin shared query layer?
- **Incremental sync:** Polling vs. FSEvents on `chat.db` (fragile) vs. periodic full scans—trade freshness vs. complexity.
- **Group chats:** Participant resolution and naming for search facets (“household thread” vs phone list).

## Success criteria (when we implement)

- User can **search message text** across history without loading entire threads into the model first.
- Disk footprint stays **predictable** with attachments excluded by default.
- **Same person** can be found from **mail or wiki or phone** and message threads **attach** to that context more often than today’s purely manual correlation.
