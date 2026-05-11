# Archived: OPP-068 — Wiki template — user-profile starter directories

**Status: Archived (2026-05-12).** Removed from the active backlog (shipped or no longer pursued).

**Stub:** [../OPP-068-wiki-template-user-profiles.md](../OPP-068-wiki-template-user-profiles.md)

---

## Original spec (historical)

### OPP-068 — Wiki template: user-profile starter directories

**Status:** future  
**Depends on:** [OPP-054](../OPP-054-guided-onboarding-agent.md) (onboarding agent), [OPP-060](../OPP-060-starter-wiki-templates-and-agent-authoring.md) (starter wiki templates)

---

## Problem

The default wiki scaffold is generic. A salesperson's mental model looks nothing like a student's or an executive's — they think in terms of **Prospects / Deals / Customers**, not in terms of **Courses / Study / Notes** or **Board / Strategy / Reports**. A one-size wiki feels foreign to most users on day one.

Shipping **fourteen independent folder trees** with duplicated definitions would be worse: the same ideas (**projects**, **notes**, **people**, **customers** / **accounts**) recur across personas. Redundant hierarchies and copy-pasted `template.md` files are hard to maintain and split agent attention.

## Idea

Define **user-profile presets**, each declaring **which** top-level directories to seed — not a bespoke file tree per persona. Keep a single **versioned catalog** of presets and a **unified template / scaffold registry** (see **Preferred implementation shape** below).

**Onboarding** does not ask the user to scan every preset up front: the agent proposes the **closest three** from that full catalog using **email traffic** signals (see below). Users can always pick **Other** and choose any preset or stay generic.

### Preferred implementation shape: one pool, persona subsets, light overrides

1. **One unifying template directory (or registry)**  
   Define each seedable area **once**: folder name, optional `index.md` shell, and a **baseline** `template.md` (or shared “area contract” in prompts). This is the **vocabulary** of the vault — e.g. `projects/`, `notes/`, `people/`, `reference/`, `interests/`, `reading/` — regardless of persona.

2. **Persona = subset + optional extras**  
   Each profile lists **included directory ids** from that pool. **Overlap is intentional**: e.g. **customers** / **accounts** might be included for both **Sales / BD** and **Product manager**; **projects** and **notes** appear for almost everyone. The design catalog table below is best read as **inclusion sets**, not unrelated hierarchies.

3. **Persona-specific `template.md` only when warranted**  
   Default: reuse the **shared** template for a folder. If “what good looks like” truly diverges (e.g. `students/` vs `prospects/`), layer a **thin override** — e.g. `templates/overrides/<profileId>/students/template.md` merged at seed time, or a persona-specific stub next to the pool. Avoid maintaining **N** full copies of the tree.

4. **Semantic drift is acceptable; prompts carry the nuance**  
   The string `projects/` might mean “class work” for a student and “delivery work” for a consultant. The **selected profile**, **`me.md`**, and mail/calendar context should bias the agent more than a long persona-specific template. Prefer **generalized, shorter** `template.md` files (hub + section hints) over rigid per-persona forms.

5. **LLM + profile over heavy templates**  
   As templates stay generalized, invest in **profile-aware system / tool guidance**: what to capture, how to name entity pages, and when to link — driven by the user’s chosen preset and behavior, not only by static markdown contracts. [OPP-060](../OPP-060-starter-wiki-templates-and-agent-authoring.md) remains the on-disk pattern; this OPP bends it toward **composition + prompting** so we do not lean on redundant prose.

**Trade-off (accepted):** Shared folder names imply slightly different emphasis per persona. The wiki and agent adapt via context; duplicating folders (`projects-student/` vs `projects/`) is usually worse than one `projects/` plus profile-aware authoring.

### Example profiles (design catalog — inclusion sets)

Treat each row as **which areas from the unified pool to enable** on first seed (plus optional **core bundle** dirs not repeated in every row — e.g. **Projects**, **Notes**, **People**, **Reference**, **Interests**). **Product manager** and **Sales / BD** might both include **Accounts** (same folder id, shared baseline `template.md`); nuance comes from **profile-aware prompts**, not duplicate trees.

Presets stay useful at large vault sizes when users add **many leaf pages per entity**, with clear hubs and naming — same idea as a large, well-factored codebase.

| Profile | Suggested top-level folders (role-flavored; compose with shared pool) |
|---|---|
| **Default** | People, Projects, Notes, Reference |
| **Knowledge worker** | Projects, Research, Reading, People, Notes, Reference |
| **Sales / BD** | Prospects, Opportunities, Accounts, Competitors, Playbooks, Notes |
| **Executive / founder** | Strategy, Board, OKRs, People, Operations, Notes |
| **Executive assistant** | Principals, Travel, Meetings, Vendors, Briefings, Runbooks, Notes |
| **Project / program manager** | Programs, Projects, Stakeholders, Milestones, Risks-Issues, Decisions, Notes |
| **Product manager** | Products, Roadmaps, Discovery, Metrics, Stakeholders, Accounts, Decisions, Notes |
| **Software developer** | Projects, Architecture, Runbooks, Research, Notes |
| **Student** | Courses, Study, Assignments, Research, Career, Notes |
| **Teacher / professor** | Courses, Lessons, Students, Grading, Professional-Development, Department, Notes |
| **Consultant / freelancer** | Clients, Engagements, Deliverables, Contracts, Reference, Notes |
| **Creator / marketer** | Campaigns, Content, Brand, Partners, Analytics, Notes |
| **Parent / household** | Family, Kids-School, Health, Home, Finance, Planning, Notes |
| **Researcher / academic** | Papers, Grants, Collaborators, Teaching, Reading, Notes |

Treat this table as the **design catalog** for preset **folder ids** and marketing copy. The **runtime catalog** passed to the scoring model may be the same set or a product-defined slice — the UX default remains **three ranked suggestions**, not a flat list of every profile.

Profiles are additive — the system still creates the user's wiki however they organically grow it. These are just a better first scaffold.

## LLM-assisted profile detection during onboarding

As part of the [guided onboarding agent (OPP-054)](../OPP-054-guided-onboarding-agent.md), after the user connects email:

1. **Derive a compact traffic summary** from the mail index: recency window, coarse volume or velocity if cheap, recurring counterparties (display names / domains), subject-line themes, calendar-adjacent mail if already available, etc. **Avoid full message bodies** in the model prompt unless there is an explicit product/privacy decision to include snippets; subjects + metadata are usually enough.
2. Pass the **complete candidate profile list**: stable ids, short human descriptions, and the suggested top-level folder labels (or a compressed projection if the catalog grows and token limits bite).
3. Ask the LLM to return **exactly three** profile ids, **ordered best → next → next**, with an optional **one-line rationale** per row (for tooltips or dev/debug). The model should consider **all** candidates; ranking is over the full set, not a pre-trimmed shortlist.
4. **UI:** surface those three as the primary choices (pre-highlight the first). Offer **See all presets** / **Generic default** so the user is never boxed in.

Weak or ambiguous signal should still yield **three** picks: pad with broadly applicable presets (**Knowledge worker**, **Default**) rather than returning fewer than three. If mail is nearly empty, three neutral options are fine.

This keeps onboarding personal without requiring the user to self-identify upfront, while avoiding a long picker before they have context.

## Why it matters

- Makes the wiki feel **immediately relevant** rather than blank.
- Reduces the "what do I put here?" friction in the first session.
- Sets up good folder structure for the buildout agent ([archived OPP-067](./archive/OPP-067-wiki-buildout-agent-no-new-pages.md)) to populate — it will have semantically sensible containers to fill.
- Cheap to extend: a new preset is mostly an **inclusion list** over the unified pool (plus optional **thin** `template.md` overrides), not a fork of the whole vault scaffold.
- **One registry to maintain:** pool definitions and shared baselines stay DRY; semantic nuance leans on **profile + user context** in agent instructions.

## Constraints / notes

- **Core use case first.** This is a polish / onboarding-quality win, not a blocker. Ship only after the default wiki experience is solid.
- Profile detection is **a hint, not a hard categorization** — do not let it constrain what the user can do.
- **Catalog size vs tokens:** the scoring step must stay within prompt budget as the preset list grows — trim prose per profile, or batch/rerank in a second stage if ever needed. **User-facing** complexity stays low because they only see **three** suggestions first.
- Merge near-duplicate presets in the catalog so rankings are not noisy. New rows can ship without migrating existing vaults.
- Profiles should be versioned / addable over time without breaking existing vaults.
- Prefer **composition** (subset of a single template pool) over **redundant hierarchies**; if a new role needs a folder id, add it to the pool once, then reference it from presets.
