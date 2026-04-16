---
name: tidy
label: "Clean up a page: fix links, reformat"
description: >-
  Review a wiki page for DRY issues, broken or stale links, excessive length, orphan status,
  and outdated facts. Propose concrete edits; do not apply changes without user confirmation
  unless they explicitly asked for automatic application.
hint: page path or paste
args: <page or topic>
version: 1
---

# Tidy a wiki page

## When to use

The user wants a **review and cleanup** pass on one wiki page (or a clearly identified page from context).

## Process

1. **Load** — Read the target page and nearby linked pages if needed.
2. **Check** — DRY (repeated blocks), link targets, heading structure, length, whether the page is orphaned, and statements that look time-sensitive.
3. **Propose** — List issues with suggested edits (unified diff or clear before/after). Use wiki edit tools only when the user expects edits.

## Quality bar

- Actionable, ordered list of fixes.
- Flag uncertainty instead of guessing facts.
