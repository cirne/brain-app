# OPP-060: Starter wiki templates + agent authoring conventions

**Status:** Active — not started  
**Tags:** `wiki` · `onboarding` · `agent` · `templates` · `vault`  
**Related:** [OPP-028](OPP-028-named-assistant-identity-and-living-avatar.md) (`assistant.md`), [OPP-033](OPP-033-wiki-compounding-karpathy-alignment.md) (Your Wiki / compounding), [OPP-054](OPP-054-guided-onboarding-agent.md) (guided onboarding — align `me.md` timing), [archived OPP-006](archive/OPP-006-email-bootstrap-onboarding.md) (profiling / seeding lineage), [archived OPP-025](archive/OPP-025-wiki-hygiene-coalescing-and-authoring-expectations.md) (authoring expectations — superseded context only)

---

## One-line summary

Ship a **curated starter wiki** for new vaults: `**me.md` and `assistant.md` shells**, **four or five standard top-level directories** each with an `**index.md`**, and **honest section placeholders** (headings + minimal “fill in later” cues). Pair with **agent-facing conventions** (system prompt and/or skills) so edits stay **consistent, well-organized, and retrieval-friendly**. Prefer a **hybrid**: **seed on-disk structure once** + **light ongoing guidance** in agent instructions so prompts and files never diverge badly.

---

## Problem

New wikis often start **empty or ad hoc**. Without shared scaffolding, pages vary wildly in **depth, headings, and placement** — hard for users to maintain and hard for the agent to **read, link, and assemble into truthful answers**. Hoping the model invents good structure on every new page does not scale.

---

## Goals

1. **Default tree:** No blank slate — users and agents see **where things live** (root pages + folder indexes).
2. **Stable vocabulary:** Reuse the **same section titles and paths** across vaults so tools, onboarding, and prompts can refer to them predictably.
3. **Truth-friendly placeholders:** Scaffolding that signals **gaps** (“not filled in yet”), not invented facts.
4. **Agent competence:** Explicit rules for **when lists vs prose**, **people page naming**, **linking to hubs**, optional **source/confidence** notes for mail-derived vs inferred content — aligned with on-disk section names.

---

## Proposed starter shape (concrete enough to implement; tune names in PR)

**Root**

- `**wiki/me.md`** — Sections such as: **Overview** (short); **Key people**; **Family**; **Coworkers / professional network**; **Projects & interests**; optional **Preferences** (timezone, communication style) — each with **one placeholder bullet** or line, e.g. “Add names and relationships as you like.”
- `**wiki/assistant.md`** — Minimal shell for [OPP-028](OPP-028-named-assistant-identity-and-living-avatar.md): assistant name slot, tone notes placeholder.

**Directories (illustrative set — pick four or five and lock in one PR)**


| Directory                  | Purpose (handwave)                 | `index.md` role                              |
| -------------------------- | ---------------------------------- | -------------------------------------------- |
| `people/`                  | Person pages linked from `me.md`   | Lists hubs; how to add a person page         |
| `projects/`                | Active threads of work             | Project stubs or empty list + link pattern   |
| `journal/` or `notes/`     | Dated or topical notes             | Optional; keeps ephemeral out of `projects/` |
| `reference/`               | Stable facts, cheatsheets, how-tos | Index of reference docs                      |
| `archive/` or `_incoming/` | Low-friction drop zone (optional)  | Explains promotion to real paths             |


Exact folder names are a **product decision** in implementation; the opportunity ships **one** canonical layout, not a menu of variants.

**Mechanism**

- **Seed at wiki/vault creation** (packaged assets copied or generated once) — deterministic, testable, works offline.
- **Do not** rely on giant template dumps in every chat turn; reserve **short** runtime reminders (“new page under `people/` follows `people/_template` pattern”) only where needed.

---

## Alignment with guided onboarding ([OPP-054](OPP-054-guided-onboarding-agent.md))

OPP-054 specifies **no authoritative `me.md` until after the onboarding interview**. Starter templates must **not** contradict that:

- **Either** ship directory shells + `assistant.md` stub **before** interview, and create `**me.md` only when onboarding authorizes the first write**,  
- **Or** ship `me.md` as **explicit non-authoritative section shells** (empty structure only) that the interview **fills/replaces** — product must choose one story and document it in the vault-init path.

This OPP owns **template content + init order**; OPP-054 owns **when profile facts land**. Coordinate in one implementation pass or sequence.

---

## Agent authoring conventions (deliverable)

Add or extend **wiki authoring guidance** wherever the main agent’s instructions are assembled:

- Prefer **clear `##` headings** matching starter sections where applicable.
- **New people** → `people/<slug>.md` + link from `me.md` Key people (or agreed subsection).
- **Uncertain facts:** brief note (“inferred from email on …”) vs stable wiki facts.
- **Chunk-friendly:** short paragraphs, bullets for enumerations, meaningful link text.

Optional: a `**wiki/README.md`** or root `**index.md**` at vault root explaining the layout for **humans** (and agents in `read_file`).

---

## Non-goals (v1)

- **i18n** of templates (English first).
- **Automatic migration** of existing long-lived vaults to the new tree (new vaults / factory reset only unless we add a separate maint tool).
- **Replacing** Your Wiki supervisor behavior ([OPP-033](OPP-033-wiki-compounding-karpathy-alignment.md)) — templates **complement** compounding, do not subsume it.

---

## Success criteria

- New vaults (or agreed bootstrap path) contain the **full starter tree** without manual steps.
- **Tests:** server or layout tests assert expected paths exist after init (see repo conventions — `src/**/*.test.ts`).
- **Docs:** this file + short pointer in [ARCHITECTURE.md](../ARCHITECTURE.md) or wiki layout doc if one exists for vault layout.

---

## Open questions (smaller — resolve during implementation)

- **Which five directories** ship in v1 (drop or merge one of the illustrative rows above).
- `**index.md` vs `README.md`** naming at folder level — pick one convention.
- **Telemetry later:** depth of `me.md`, link counts, rate of user-deleted boilerplate (future).

---

## References

- Product stance on breaking changes / migrations: [AGENTS.md](../../AGENTS.md) (early development — prefer clean breaks over dual paths).