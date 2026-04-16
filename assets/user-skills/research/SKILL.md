---

## name: research
label: "Deep research → wiki: sources, synthesis, DRY, size, links"
description: >-
  Multi-source investigation (wiki, email, web, video when useful) that lands as durable wiki
  page(s)—not a one-line chat answer. Examples: “research competitors to X and add a page under
  strategy/”; “pull together everything we know about Project Y with citations”; “investigate Z and
  write a hub page plus evidence subpages”. If the user only needs a quick lookup or “where did I
  put this,” use normal chat. For editing an existing page without deep investigation, use /wiki.
hint: question, scope, or where to publish—your words
args: >-
  Optional natural language: topic, boundaries, desired path, or a line budget. Default ~400 lines
  per primary page unless the user specifies otherwise.
version: 1

# Deep research

**Research** produces **durable wiki output**, not a one-off reply. Same quality bar as `/wiki` for accuracy, DRY, navigable size, and real internal links—but the emphasis is **gather from many sources**, then **synthesize**.

## When to use

- The user wants **thorough investigation** and a write-up in the wiki.
- **Not** for: simple grep/read/find in the wiki (plain chat) or light edits on one page (`/wiki`).

## When to use vs /wiki

- `**/research`:** Multi-source synthesis **before** or **while** writing canonical prose; new evidence from outside the wiki is central.
- `**/wiki`:** Creating, tidying, or pruning wiki content without a research-heavy gather phase.

## Defaults (inside the skill)

- **Primary page size:** about **400 lines** of body (excluding frontmatter). If the user asks for a different cap in natural language, use it.
- **Over budget:** Hub page (question, conclusions, map of sections) plus child pages for evidence, timelines, or deep dives.

## Process

1. **Scope** — Restate the question and boundaries (time, geography, product area). Say what is in and out.
2. **Gather** — Wiki read/search first (respect local canon), then email, web, and other tools. Prefer primary sources; capture enough pointer/citation to re-find material.
3. **Synthesize** — Structured markdown: facts vs inference clearly separated. Link to related wiki pages instead of repeating them.
4. **DRY** — If a fact already lives on another page, one sentence + link; do not fork canonical content.
5. **Size** — Fit the main page in budget; split or move detail to linked pages when needed.
6. **Links** — Internal wikilinks plus external citations where appropriate; repair or avoid broken refs before saving.
7. **Gaps** — State what you could not verify.
8. **Apply** — Save through the normal wiki edit flow (multiple files if split). Do not deliver only a proposal unless the user asked for notes without publishing.

## Quality bar

- One obvious entry page (hub) with clear navigation when multi-page.
- Explicit separation of established facts vs inference vs open questions.
- Deduped against existing wiki pages; new text adds synthesis, not duplication.
- Links in and out are honest and usable.