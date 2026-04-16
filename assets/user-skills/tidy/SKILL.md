---
name: tidy
label: "Fix a wiki page: accuracy, DRY, links, format"
description: >-
  Fix the target wiki page in place: verify accuracy, dedupe against the rest of the wiki (one
  source of truth), reformat for legibility and agent-friendly structure, add links to referenced
  docs, and repair broken links. Apply edits directly; do not stop at proposals or suggestions.
hint: page path or paste
args: <page or topic>
version: 2
---

# Tidy a wiki page

## When to use

The user wants a **direct cleanup** of one wiki page: apply fixes, not a review-only report.

## Process

1. **Load** — Read the target page and follow links to related pages; scan the wiki for duplicate or conflicting statements about the same facts.
2. **Accuracy** — Correct wrong or outdated claims; if something cannot be verified, align wording with the canonical source elsewhere in the wiki or remove unsupported claims rather than guessing.
3. **DRY** — Prefer a single source of truth: remove redundant paragraphs, replace copies with a short summary plus a link to the authoritative page, or consolidate when the same content appears in multiple places.
4. **Links** — Add wiki links to documents and concepts the page references; fix broken or stale links; use the same paths/titles the wiki already uses.
5. **Format** — Improve headings, lists, spacing, and scanability; structure for both humans and agents (clear hierarchy, stable anchors, scannable bullets where appropriate).
6. **Apply** — Write the updated page through the wiki edit flow. Do not deliver only a proposal list unless the user explicitly asked for review without edits.

## Quality bar

- The saved page is measurably better: accurate, deduped, well-linked, and easier to read.
- Uncertainty is resolved by checking the wiki or tightening language—not by leaving placeholder proposals.
