---
name: tidy
label: "Lint + refactor a wiki page: accuracy, DRY, size, links, format"
description: >-
  Like lint-and-refactor for code: fix the target wiki page in place—accuracy, DRY across the wiki,
  agent-friendly size (split oversized pages into smaller linked pages), legible structure, full
  and repaired links. Apply edits directly; do not stop at proposals or suggestions.
hint: page path or paste; optional size budget
args: <page or topic> [max-lines]
version: 3
---

# Tidy a wiki page

Wiki **tidy** is the analogue of **lint + refactor** for prose: tighten truth, remove duplication, fix navigation, and keep each page small enough that an agent (or human) can load and use it without drowning in context.

## When to use

The user wants a **direct cleanup** of one wiki page: apply fixes, not a review-only report.

## Size budget (agent-friendly)

Long pages behave like huge source files: hard to fit in context, easy to edit wrong. Enforce a **maximum size** on the page after tidy:

- **Default `max-lines`:** about **400 lines** of rendered/markdown content (excluding frontmatter if present). If the user does not pass a second argument, use this default.
- **Override:** If the user passes `max-lines` (e.g. `wiki/foo 250` or `wiki/foo 600`), use that number as the hard cap for the **main** page you leave behind.
- **When over budget:** **Refactor, do not merely compress.** Move coherent sections to new or existing child/sibling pages; replace inlined detail with short summaries plus links; keep the original page as a **hub** with a clear outline and links. Prefer one obvious topic per page, same spirit as splitting a large module.

Do not ask the user for a number unless they gave no hint and the wiki has no convention—in that case use the default above.

## Process

1. **Load** — Read the target page and follow links to related pages; scan the wiki for duplicate or conflicting statements about the same facts.
2. **Accuracy** — Correct wrong or outdated claims; if something cannot be verified, align wording with the canonical source elsewhere in the wiki or remove unsupported claims rather than guessing.
3. **DRY** — Prefer a single source of truth: remove redundant paragraphs, replace copies with a short summary plus a link to the authoritative page, or consolidate when the same content appears in multiple places.
4. **Size** — After other edits, ensure the page (and any new pages you create) respects the size budget; split and link when needed.
5. **Links** — Add wiki links to documents and concepts the page references; fix broken or stale links; use the same paths/titles the wiki already uses.
6. **Format** — Improve headings, lists, spacing, and scanability; structure for both humans and agents (clear hierarchy, stable anchors, scannable bullets where appropriate).
7. **Apply** — Write updates through the wiki edit flow (including new pages when splitting). Do not deliver only a proposal list unless the user explicitly asked for review without edits.

## Quality bar

- The saved page is measurably better: accurate, deduped, within the size budget (or deliberately split), well-linked, and easier to read.
- Uncertainty is resolved by checking the wiki or tightening language—not by leaving placeholder proposals.
