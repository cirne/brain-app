---
name: research
label: "Deep research → wiki: sources, DRY, size, links"
description: >-
  Multi-source investigation (wiki, email, web, video when useful). Synthesize into durable wiki
  page(s): one source of truth with other pages linked, agent-friendly structure and size (hub +
  linked detail when needed), citations or pointers to sources. Write to the wiki directly; do not
  stop at a chat summary unless the user asked for notes only.
hint: question or scope; optional size budget
args: <topic> [max-lines]
version: 2
---

# Deep research

**Research** produces **durable wiki output**, not a one-off chat answer. Reuse the same bar as **tidy** and **new**: accurate claims, DRY relative to existing pages, navigable size, and real internal links.

## When to use

The user wants **thorough investigation** and a write-up in the wiki, not a quick unsupported reply.

## Size budget (agent-friendly)

Large research should not become a single megapage:

- **Default `max-lines`:** about **400 lines** for the **primary** page (body, excluding frontmatter). Optional second argument overrides.
- **When synthesis exceeds the budget:** Use a **hub** page (question, conclusions, map of sections) plus **child** pages for evidence, timelines, or deep dives—each child within the same budget where possible.

## Process

1. **Scope** — Restate the question and boundaries (time, geography, product area). Say what is in and out.
2. **Gather** — Wiki read/search first (avoid contradicting local canon), then email, web, and other tools. Prefer primary sources; capture enough pointer/citation to re-find material.
3. **Synthesize** — Write structured markdown: facts vs inference clearly separated. Link to related wiki pages instead of repeating them.
4. **DRY** — If a fact already lives on another page, summarize in one sentence and link; do not fork canonical content.
5. **Size** — Fit the main page in budget; split or move detail to linked pages when needed.
6. **Links** — Internal wikilinks plus external citations where appropriate; repair or avoid broken refs before saving.
7. **Gaps** — State what you could not verify.
8. **Apply** — Save to the wiki through the normal edit flow (multiple files if split). Do not deliver only a proposal unless the user asked for research notes without publishing.

## Quality bar

- Canonical output: one obvious entry page (hub) with clear navigation when multi-page.
- Explicit separation of established facts vs inference vs open questions.
- Deduped against existing wiki pages; new text adds real synthesis, not duplication.
- Within size budget or deliberately split; links in and out are honest and usable.
