# Archived: OPP-088 — Canonical `who` + contacts

**Status: Archived (2026-05-11).** Ripmail corpus backlog closed for tracking.

**Stub:** [../OPP-088-contacts-unified-who-canonical-identity.md](../OPP-088-contacts-unified-who-canonical-identity.md)

---

## Original spec (historical)

### OPP-088: System contacts + canonical `who` — identity graph, phones, cross-channel agents

**Former ripmail id:** OPP-054 (unified backlog 2026-05-01).

**Status:** Active — product / architecture direction.

**Created:** 2026-04-19.

**Constraint (explicit):** **No backward-compatibility requirement.** Implementers may replace `person_id` schemes, SQLite shapes, and CLI output (text and JSON) without migration paths from prior `ripmail who` behavior. Clean-slate is preferred when it shortens the path to a correct agent contract.

---

## Summary

Add **first-class system contacts** (Google People API + macOS **ContactKit** via the same **native-helper / permission** pattern as calendar in [OPP-053 archived](../../ripmail/docs/opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md)), and **redefine `ripmail who`** so it returns a **single canonical view per human** — **merged emails**, **phone numbers (E.164)**, **display aliases**, aggregated mail **interaction stats**, and stable **lookup keys** for tools that index by **phone or handle** (local Messages / future messaging index in [OPP-083](OPP-083-imessage-and-unified-messaging-index.md)).

**No LLM** participates in merge or deduplication: use an **offline identity graph** (union over high-confidence edges), deterministic **canonical naming** (Contacts beats mail header; nickname / fuzzy rules only **within** a cluster), and structured **JSON** for host agents.

---

## Problem

1. **`who` is keyed by one email** — `person_id` is derived from a single normalized address, so the same person with two addresses appears twice; “Lew Cirne” and “Lewis Cirne” in different headers do not converge unless they share one normalized email.

2. **Phones are not first-class in `who` output** — signature parsing and wiki grep act as partial bridges; brain-app `find_person` stitches `ripmail who` + wiki. Agents still struggle to go **calendar attendee → phone → SMS/iMessage**, because Messages tooling keys on **chat identifier / phone digits**, not display names.

3. **Contacts live outside mail** — Apple and Google already correlate names, phones, and multiple emails on one card. Ignoring that duplicates work and weakens cross-channel reasoning.

---

## Opportunity

### 1. Contacts as sources (align with [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md))

- **`googleContacts`** — Google **People API**, OAuth scopes added to existing Google auth ([OPP-042](../../ripmail/docs/opportunities/OPP-042-google-oauth-cli-auth.md)); incremental sync token per account; normalized rows in SQLite.
- **`appleContacts` (macOS only)** — **ContactKit** (`CNContactStore`) through a **small native helper** next to `ripmail`, same trust/TCC story as EventKit in OPP-053; non-macOS: clear unsupported.

Each source writes **typed identifiers** and optional **structured name fields** into a local contacts projection (not “replace Google”; local index for queries and merges).

### 2. Canonical person = connected component, not one email

Build a graph whose **nodes** are identifiers (normalized email, E.164 phone, external **contact card id**, calendar attendee email, etc.) and **edges** are “same person” when:

- **Hard:** same normalized phone; same Contacts-backed card id; explicit multi-value on one card (email A + email B + phone P).
- **Medium:** attendee **email** from an indexed calendar event matches an email on a person cluster ([OPP-053 archived](../../ripmail/docs/opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md) calendars feed this).
- **Soft (optional, tunable):** avoid aggressive name-only merges across emails unless additional corroboration exists (shared domain + fuzzy match, etc.). Prefer marking uncertain links with **`mergeConfidence`** in JSON over silent collapse.

Use **union-find** (or equivalent) offline during **`refresh` / `who --rebuild`** — no LLM.

### 3. Redefined `ripmail who`

- **Default output:** one row per **person cluster** (not per email).
- **JSON fields (illustrative):** `canonicalName`, `aliases`, `emails[]`, `phones[]` (value + label + source), aggregated **`contactRank`** / owner-centric counts across all linked addresses, `lastContact`, optional **`calendarPersonKeys`**, **`messageHandles`** (E.164 and other forms suitable for **`chat_identifier`** / grep).
- **Query:** name, email, or phone resolves to the **same** cluster; phonetic/fuzzy name match remains for **filtering**, not for **proposing** merges without identifier overlap.

### 4. Agent use case: dinner on calendar → texts

1. Calendar tool returns event with **attendee emails** (and names).
2. **`who` JSON** resolves email → **phones** and **message handles**.
3. Host calls **`list_recent_messages` / get_message_thread** (or future ripmail-native message index) using those handles — **no** LLM merge step.

---

## Implementation notes (non-prescriptive)

- **Schema:** dedicated tables (`contact_identifiers`, `person_clusters`, optional `person_cluster_members`) plus FTS on names if needed; or a redesign that replaces the current single-email `who` aggregation path entirely — compatibility not required.
- **Canonical naming priority (example):** structured name from synced Contacts → longest consistent mail/calendar display name in cluster → `infer_name`-style fallback from primary email.
- **Nickname / variant names (“Lew” vs “Lewis”):** reuse and extend existing **nickname** / phonetic / fuzzy helpers for **label choice within a cluster**, not as the primary merge driver.
- **Privacy:** same stance as OPP-053 — document what is indexed and what agents may surface.

---

## Non-goals (v1)

- Full CRM parity, company-wide directory semantics, or guaranteed-perfect dedupe without identifier overlap.
- LLM-based entity resolution or clustering of the entire mailbox.
- obligating migration from legacy `who` JSON or text layouts.

---

## Related

- [OPP-077](OPP-077-who-smart-address-book.md) — **archived (done enough)** mail-centric `who` ship list; this opp **supersedes direction** for the next-generation identity layer where that work lands.
- [OPP-053 archived](../../ripmail/docs/opportunities/archive/OPP-053-local-gateway-calendar-and-beyond.md) — calendar + same-binary native surface; **attendee email** correlation with `who` clusters.
- [OPP-087](OPP-087-unified-sources-mail-local-files-future-connectors.md) — `sources` model for connectors.
- [OPP-042](../../ripmail/docs/opportunities/OPP-042-google-oauth-cli-auth.md) — Google OAuth; scope expansion for People API.
- [OPP-083](OPP-083-imessage-and-unified-messaging-index.md) — messaging index / handles; complementary to phone-first lookup from `who`.
- Brain-app: `find_person` tool and local Messages tooling — should **consume** canonical `who` JSON once available.

---

## Open questions

1. **User overrides:** config file for “always split” / “always merge” pairs (low priority until core graph works).
2. **Workspace (Google) vs consumer:** People API behavior and labeling when directory contacts differ from “My contacts”.
3. **Whether `who` stays a subcommand or gains a `ripmail person` / `ripmail contacts` split** for refresh vs query — UX only; JSON contract matters more than spelling.
