---
name: prune
label: "Prune wiki subtree: DRY, orphans, structure"
description: >-
  Structural lint for a wiki area: find duplicates, orphans, stale pages, and oversized pages.
  Prefer merges, moves, and new links (apply directly). Reserve explicit user confirmation for
  irreversible deletes or ambiguous cases. Align with one source of truth and agent-friendly page
  sizes (same defaults as tidy).
hint: folder or scope; optional size threshold
args: <subtree or topic> [max-lines]
version: 2
---

# Prune wiki content

**Prune** is **lint + refactor** at **tree** scope: tidy fixes one page; prune fixes how pages relate—duplication, navigation, and dead weight. Use the same DRY and size instincts as **tidy** and **new**.

## When to use

The user wants to **clean up structure** over an area of the wiki: duplicates, stale pages, orphans, or bloated pages that should be split.

## Size threshold (agent-friendly)

Use the same line budget as **tidy** for flagging “too big” pages:

- **Default `max-lines`:** about **400 lines** (body, excluding frontmatter). Override if the user passes a second argument.
- **Action:** Oversized pages are candidates for **tidy** (split into hub + children) or for moving detail to a child page during prune—execute that refactor when the outcome is obvious; otherwise leave a clear note on what tidy should do.

## Process

1. **Map** — List pages in scope (tree read / search). Note meaningful recency or staleness from context when available.
2. **Classify** — For each page: obsolete, duplicate of another, orphan (no sensible inbound links), merge candidate, oversized (see threshold), or keep.
3. **DRY** — For duplicates: choose or designate a **canonical** page; merge unique content into it, replace the loser with a short stub that links to canonical, or delete the empty redundant file only when policy allows—**never mass-delete** without explicit user approval for destructive steps.
4. **Structure** — Fix orphans by adding links from indexes, parents, or related pages; suggest or apply moves when path conventions are wrong.
5. **Apply** — **Execute** non-destructive fixes directly: merges that preserve content, new links, moves/renames your tools support, redirects/stubs. **Ask first** before permanent deletion, bulk delete, or anything that loses history without an archive.
6. **Report** — Brief summary of what changed and what still needs a human call (if anything).

## Quality bar

- Minimize surprise: every merge, move, or delete candidate has a one-line reason.
- Prefer merge, stub+link, or redirect over delete when history or inbound links matter.
- Outcomes move the subtree toward one source of truth and navigable, agent-sized pages.
