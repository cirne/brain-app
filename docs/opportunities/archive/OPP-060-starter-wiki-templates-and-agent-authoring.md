# Archived: OPP-060 — Starter wiki templates + authoring conventions

**Archived 2026-04-30.** **Status: Implemented (core).** `wikiVaultScaffold.ts` / `ensureWikiVaultScaffoldForBuildout`, per-folder `template.md`, `me.md` / `assistant.md` / `index.md`; prompts in `wiki-buildout/system.hbs`, `assistant/base.hbs`. **Stable URL:** [stub](./OPP-060-starter-wiki-templates-and-agent-authoring.md).

---

# OPP-060: Starter wiki templates + agent authoring conventions

**Tags:** `wiki` · `onboarding` · `agent` · `templates` · `vault` · `travel` · `hygiene`  
**Related:** [OPP-028](../OPP-028-named-assistant-identity-and-living-avatar.md) (`assistant.md`), [OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md) (Your Wiki / compounding), [OPP-054](./OPP-054-guided-onboarding-agent.md) (guided onboarding — align `me.md` timing), [trip sheet skill](../../../.cursor/skills/trip-sheet/SKILL.md) (trip-sheet workflow aligns with `travel/`), [archived OPP-006](./OPP-006-email-bootstrap-onboarding.md) (profiling / seeding lineage), [archived OPP-025](./OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md) (authoring expectations — superseded context only)

---

## One-line summary

Ship a **curated starter wiki** for new vaults: `**me.md` and `assistant.md` shells**, **standard top-level directories** each with `**index.md` (browse / inventory)** and `**template.md` (first-class pattern for new pages)**, plus **honest placeholders**. Pair with **agent-facing conventions** so edits stay **consistent, well-organized, and retrieval-friendly**, including **cleanup of stale content** in **ephemeral** areas (`notes/`, `travel/`) so outdated pages do not pollute context. Prefer a **hybrid**: **seed on-disk structure once** + **light ongoing guidance** in agent instructions.

---

## Problem

New wikis often start **empty or ad hoc**. Without shared scaffolding, pages vary wildly in **depth, headings, and placement** — hard for users to maintain and hard for the agent to **read, link, and assemble into truthful answers**. Hoping the model invents good structure on every new page does not scale.

When a directory has **no pages yet**, the agent has **no on-disk example** of “good” shape for that folder. Burying long “how to write” prose in `**index.md`** fights the role of the index as a **surfacing** page (what’s here, where to click next). **Templates as separate artifacts** keep browsing clean and give the agent a **stable file to read** before minting new notes.

---

## Goals

1. **Default tree:** No blank slate — users and agents see **where things live** (root pages + folder indexes).
2. **Stable vocabulary:** Reuse the **same section titles and paths** across vaults so tools, onboarding, and prompts can refer to them predictably.
3. **First-class `template.md`:** In each seeded directory (see below), a `**template.md`** encodes **headings, optional sections, and brief cues** for “what a good page here looks like” — with **Goldilocks depth** and **domain-specific** sections so the agent knows what to gather (mail, calendar, web) and when a page is “useful, not bloated” (see **What makes a great `template.md`**). The **user can edit** their copy; they can also ask the **agent to revise** `template.md` to better match their workflow.
4. `**index.md` vs `template.md`:** `**index.md`** is for **discovery** — short intro, links to notable pages, scannable list of what’s in the folder (updated as content grows). `**template.md`** is for **authoring pattern** — not a substitute for the index and **not** the place to duplicate the full directory listing.
5. **Truth-friendly placeholders:** Scaffolding that signals **gaps** (“not filled in yet”), not invented facts.
6. **Agent competence:** Explicit rules for **when lists vs prose**, **people page naming**, **linking to hubs**, optional **source/confidence** notes for mail-derived vs inferred content — aligned with on-disk section names; **prefer reading `template.md`** before creating a new file in an unfamiliar folder.
7. **Ephemeral vs durable:** Some directories hold content that should **age out** (`notes/`, completed `**travel/`** trips). Agent instructions should **encourage pruning, archiving, or tightening** so stale pages **do not pollute retrieval**; durable areas (`people/`, `reference/`) stay long-lived by default.

---

## Per-directory files (normative for the seeded tree)

For each standard top-level folder we ship:


| File              | Purpose                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**index.md`**    | **Browse / hub** — what this folder is for, links into real pages, optional “start here” for humans. Grows as pages appear.                                    |
| `**template.md`** | **Pattern for new pages** — section headings, example bullets (clearly marked as examples or placeholders), naming hints. **Not** a dump of every future page. |


**Agent workflow (intended):** When adding a page under `foo/`, **read `foo/template.md`**, then `**write**` a new file (e.g. `foo/my-trip-paris.md`) following that shape; **link** from `foo/index.md` when appropriate. If `template.md` is missing user-specific prefs, **infer from user chat** and optionally `**edit`** `template.md` when the user wants the default pattern updated.

**Naming:** Ship as `**template.md`** (not hidden `_template`) so it is visible, linkable, and discoverable; product may still mention “the folder template” in prompts without exposing internal aliases.

---

## What makes a great `template.md` (for implementers)

Shipped templates are not just **headings** — they are **contracts** between the vault, the user, and the agent. A great template makes the *next* page **retrieval-friendly**, **honest about gaps**, and **sized for real questions** the user will ask. When authoring or reviewing `template.md` files, use the following.

### Goldilocks depth

- **Too shallow:** A page that only has a title and “TBD” teaches the agent nothing about *which* facts matter or *when* the page is “done enough” to be useful in chat and search.
- **Too large:** A template that looks like a form with thirty required fields encourages bloated pages, discourages creating the file, and pollutes RAG with empty sections.
- **Target:** **One screen of structure** in the template file: a **small set of `##` sections** (typically 4–8) with **1–3 bullet cues each** (what belongs here, not lorem ipsum). Each section should answer: *What user question does this help the assistant answer later?*

### Cue “intelligent incompleteness”

The template should make it **obvious when the agent still needs to use tools** (mail, calendar, web) before the page is trustworthy.

- Use **explicit placeholder phrasing** in the template text: e.g. “Relationship to you: *(evidence: mail thread, intro, or user-stated — do not guess)*.”
- Prefer **optional sections** over mandatory encyclopedia sections; mark fragile facts (**role at company**, **relationship**) as **evidence-backed** in the template instructions.
- Where inference is common but risky, the template can ask for a **one-line provenance** (“Source: …”) — aligned with agent authoring conventions elsewhere in this OPP.

### Domain-specific: what the LLM should anticipate

Templates should reflect **the kinds of questions people actually ask** Braintunnel about that domain — so sections are **answer-shaped**, not generic.

| Domain | Users often ask… | A strong template therefore cues… |
|--------|------------------|-----------------------------------|
| **People** | Who is this to me? How do I know them? What should I remember before I reply? | **Identifiers** (email, phone only when evidenced), **relationship / context** (coworker, family, vendor — from evidence), **threads or domains** (what you coordinate on), **preferences / sensitivities** when known, **wikilinks** to `[[projects/…]]`, `[[topics/…]]`, or orgs. Avoid biography bloat; prefer *actionable* context. |
| **Projects** | What’s the goal, who’s involved, what’s the status, what’s blocking? | **Goal / scope**, **status** (active, paused, shipped), **key people** (wikilinks), **key topics**, **next actions** or **decisions** (short). Size for *recurring* work, not one-off tasks (those may live in `notes/` or a project bullet). |
| **Topics / interests** | What is this about in *my* life? How does it connect to people and projects? | **Definition in one paragraph**, **why it matters to the user** (if known), **links** to people/projects, **durable facts** vs **fleeting** (move fleeting to `notes/`). |
| **Organizations (companies, teams)** | How do I reach them? Who is my contact? What’s our history? | **Identifiers** (domain, support channels) from public or mail — **no invented phone numbers**; **primary contact** as wikilink to `people/…` when a person is the interface; **relationship** (customer, employer, vendor). |
| **Travel / trip sheets** | When, where, reservations, what’s the next move, what if plans change? | **Itinerary shape** aligned with the [trip sheet skill](../../../.cursor/skills/trip-sheet/SKILL.md): trip window, **reservations** (flights, hotels) with **evidence-based** times, **links** to calendar or mail, **ground transport**, **after trip: summarize or archive** so the page does not live as stale context forever. |
| **Notes (ephemeral)** | Is this still relevant? Where did I put the durable version? | **Date or context**, **one link** to the durable home (person/project/topic) if the note is a **capture**; **reminder to delete or fold** when superseded. |

If a section is only useful for a **subset** of pages in that folder, mark it **optional** in the template so the agent does not pad every file.

### Cross-linking and reuse

- Templates should **name the wikilink patterns** the graph should use (e.g. `[[people/…]]`, `[[projects/…]]`) so the assistant does not invent parallel hierarchies.
- Prefer **one canonical place** for a fact (e.g. job title on the **person** page, not repeated on every project page) and use **short links** elsewhere.
- `index.md` stays the **map**; `template.md` is the **blueprint** — do not duplicate the full directory list in the template (per goals above).

### Handoff to the agent in chat

The template file is read **before** `write`. Good section titles **match** the main agent and wiki-buildout prompts where possible, so the same `##` names appear in **on-disk pages**, **search**, and **RAG** — stable vocabulary across the product.

---

## Proposed starter shape (concrete enough to implement; tune names in PR)

**Root**

- `**wiki/me.md`** — Sections such as: **Overview** (short); **Key people**; **Family**; **Coworkers / professional network**; **Projects & interests**; optional **Preferences** (timezone, communication style) — each with **one placeholder bullet** or line, e.g. “Add names and relationships as you like.”
- `**wiki/assistant.md`** — Minimal shell for [OPP-028](../OPP-028-named-assistant-identity-and-living-avatar.md): assistant name slot, tone notes placeholder.
- `**wiki/index.md**` — Vault home / TOC (consistent with wiki buildout expectations): links to `[[me]]`, major hubs, and top-level directories.

**Directories (illustrative set — lock one canonical layout in implementation)**

Fill in each **`template.md`** using the **What makes a great `template.md`** section: right granularity per domain (people, projects, travel, notes, topics/reference), **evidence cues**, and **cross-links** — not generic outline stubs.

Ephemeral-friendly dirs (`notes/`, `travel/`) should ship `**template.md`** sections that mention **post-trip / post-note cleanup** (archive link, delete when obsolete, or fold facts into durable pages).


| Directory                               | Purpose (handwave)                                                                                         | `index.md`                                             | `template.md`                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `**people/`**                           | Person pages linked from `me.md`                                                                           | List / link to person pages; short “how we name slugs” | Person page shape: identifiers, relationship, **no invented facts**                               |
| `**projects/`**                         | Active threads of work                                                                                     | Projects list + links                                  | Project one-pager: goal, status, links to people/topics                                           |
| `**topics/**` (and/or `**reference/**`) | Durable themes vs stable cheatsheets                                                                       | Browse topics or reference entries                     | Distinct templates if both dirs ship: topic page vs reference sheet                               |
| `**notes/**`                            | Quick captures, dated or scratch; **clean up more aggressively** than durable dirs                         | Recent / tagged notes                                  | Short-lived note pattern; **reminder to archive or delete when stale**                            |
| `**travel/`**                           | Trips, reservations, trip-sheet style facts ([trip sheet skill](../../../.cursor/skills/trip-sheet/SKILL.md)) | Per-trip links or by date                              | **Good trip sheet shape** (logistics, reservations, links) + **after trip: summarize or archive** |


Optional v1 additions (if not merged elsewhere):

- `**archive/`** or `**_incoming/**` — Low-friction drop zone; `index.md` explains promotion into real paths; `**template.md**` optional or minimal.

Exact folder names and whether `**topics/**` and `**reference/**` are both top-level are **product decisions** in implementation; ship **one** canonical layout, not a menu of variants. `**travel/`** is recommended as a first-class directory so trip-sheet structure is **on-disk and repeatable**, not only skill text.

---

## Mechanism

- **Seed at wiki/vault creation** (packaged assets copied or generated once) — deterministic, testable, works offline.
- **Do not** rely on giant template dumps in every chat turn; short runtime reminders only where needed (e.g. “Before a new `travel/` page, read `travel/template.md`”).
- **Templates are living documents:** user-editable; agent may update `**template.md`** when asked so patterns improve over time.

---

## Alignment with guided onboarding ([OPP-054](./OPP-054-guided-onboarding-agent.md))

OPP-054 specifies **no authoritative `me.md` until after the onboarding interview**. Starter templates must **not** contradict that:

- **Either** ship directory shells + `assistant.md` stub + `**index.md` / `template.md` trees** **before** interview, and create `**me.md` only when onboarding authorizes the first write**,  
- **Or** ship `me.md` as **explicit non-authoritative section shells** (empty structure only) that the interview **fills/replaces** — product must choose one story and document it in the vault-init path.

This OPP owns **template content + init order**; OPP-054 owns **when profile facts land**. Coordinate in one implementation pass or sequence.

---

## Agent authoring conventions (deliverable)

Add or extend **wiki authoring guidance** wherever the main agent’s instructions are assembled:

- Prefer **clear `##` headings** matching starter sections where applicable.
- **New people** → `people/<slug>.md` + link from `me.md` Key people (or agreed subsection).
- **Uncertain facts:** brief note (“inferred from email on …”) vs stable wiki facts.
- **Chunk-friendly:** short paragraphs, bullets for enumerations, meaningful link text.
- **Before creating a file in a standard folder, read that folder’s `template.md`** when present.
- **Hygiene / retrieval:** For `**notes/`**, `**travel/**`, and similar **ephemeral** areas, **prefer removing, archiving, or merging** content that is **out of date** (trip finished, note superseded) so search and RAG are not **polluted** by stale pages. Durable dirs are cleaned **less often** and favor **edit-in-place** over deletion.

Optional: a `**wiki/README.md`** (or rely on root `**index.md**`) explaining the layout for **humans** and agents.

---

## Non-goals (v1)

- **i18n** of templates (English first).
- **Automatic migration** of existing long-lived vaults to the new tree (new vaults / factory reset only unless we add a separate maint tool).
- **Replacing** Your Wiki supervisor behavior ([OPP-033](../OPP-033-wiki-compounding-karpathy-alignment.md)) — templates **complement** compounding, do not subsume it.

---

## Success criteria

- New vaults (or agreed bootstrap path) contain the **full starter tree** (including `**index.md` + `template.md`** per standard directory) without manual steps.
- **Tests:** server or layout tests assert expected paths exist after init (see repo conventions — `src/**/*.test.ts`).
- **Docs:** this file + short pointer in [ARCHITECTURE.md](../../ARCHITECTURE.md) or wiki layout doc if one exists for vault layout.

---

## Open questions (smaller — resolve during implementation)

- **Exact directory list for v1** — e.g. whether both `**topics/`** and `**reference/**` ship, and whether `**archive/**` / `**_incoming/**` are included.
- `**index.md` vs `README.md**` at folder level — pick **one** convention for folder hubs (root vault already favors `**index.md`** in wiki buildout).
- **Telemetry later:** depth of `me.md`, link counts, rate of user-edited `**template.md`**, rate of deleted boilerplate (future).

---

## References

- Product stance on breaking changes / migrations: [AGENTS.md](../../../AGENTS.md) (early development — prefer clean breaks over dual paths).

