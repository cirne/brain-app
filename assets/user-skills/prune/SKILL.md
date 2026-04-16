---
name: prune
label: Prune
description: >-
  Find obsolete, duplicate, or orphan pages under a subtree. Propose merges, moves, redirects,
  or deletions for user review — do not mass-delete without confirmation.
hint: folder or scope
args: <subtree or topic>
version: 1
---

# Prune wiki content

## When to use

The user wants to **clean up structure** over an area of the wiki: duplicates, stale pages, orphans.

## Process

1. **Map** — List pages in scope (tree read / search). Note last meaningful edits if available from context.
2. **Classify** — Obsolete, duplicate, orphan, merge candidate, or keep.
3. **Propose** — Concrete actions: merge A into B, move under `folder/`, archive note, delete (only with explicit user approval for destructive steps).

## Quality bar

- Minimize user surprise: explain why each page is a candidate.
- Prefer merge and redirect over delete when history matters.
