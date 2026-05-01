---
name: backlog
description: Maintains brain-app bug and opportunity hygiene—reconciles docs with code, archives completed work, files new items, and updates unified `docs/BUGS.md` + `docs/OPPORTUNITIES.md`. Use when the user invokes /backlog, asks to triage bugs or opportunities, review the backlog, archive fixed issues, or align tracking docs with reality.
---

# Backlog (bugs & opportunities)

The repo uses **one backlog** under **`docs/BUGS.md`** and **`docs/OPPORTUNITIES.md`** (spec files in **`docs/bugs/`**, **`docs/opportunities/`**, and their **`archive/`** subfolders).

**`ripmail/docs/BUGS.md`** and **`ripmail/docs/OPPORTUNITIES.md`** are pointers; historical stubs and narratives may remain under **`ripmail/docs/bugs/`** / **`ripmail/docs/opportunities/`** (including **`archive/`**) for deep links and pre-monorepo history.

## When to run this

- Periodic **hygiene**: active lists match shipped code; fixed items are not left in active paths with contradictory **Status:**
- **Close / archive** a bug or OPP that is done, superseded, or closed enough for a stated scope
- **File** a new bug or opportunity with the right path (**`docs/`** canonical) and the index updated
- **Split** a big OPP: archive the old narrative, add a new OPP or bug for what is still open

## Where things live

| Kind | Canonical location |
|------|---------------------|
| Active bugs | `docs/bugs/BUG-NNN-….md` |
| Archived bugs | `docs/bugs/archive/` |
| Bug index | `docs/BUGS.md` |
| Active opportunities | `docs/opportunities/OPP-NNN-….md` |
| Archived opportunities | `docs/opportunities/archive/` |
| OPP index | `docs/OPPORTUNITIES.md` |

**Historical / crate-local:** `ripmail/docs/**` stubs + **`archive/`** only (no parallel active index).

**Convention:** Next id is the **smallest unused integer** under **`docs/bugs`** / **`docs/opportunities`** (excluding archive rows that consumed the number). **One ticket = one number.**

## Hygiene: doc vs code

1. Read **`docs/BUGS.md`** / **`docs/OPPORTUNITIES.md`** and scan non-archive specs for **`Status:`** that contradict the index row.
2. For **suspected done**: confirm in the codebase before archiving.
3. For **stale** docs: update body or prepend archive banner; **move** via `git mv` to **`archive/`**; fix in-repo links (grep the bug/OPP id).
4. **Security / MT items:** if fixed is app-layer only, keep open with shipped vs remaining.

## New bug

1. **`docs/bugs/BUG-NNN-short-slug.md`**: title **`# BUG-NNN:`**, symptom, repro/evidence if known, expected, **`Status:`** Open (optional severity/tags).
2. Add row to **Active** in **`docs/BUGS.md`**.
3. Cross-link if spanning app + ripmail.

## New opportunity (OPP)

1. **`docs/opportunities/OPP-NNN-short-slug.md`**: problem, direction, Related, Status.
2. Add row to **Active** in **`docs/OPPORTUNITIES.md`**.

## Close and archive — summary

Set final **Status**, **`git mv`** to **`bugs/archive/`** or **`opportunities/archive/`**, update **`docs/BUGS.md`** / **`docs/OPPORTUNITIES.md`** table, grep for id + old paths and fix links.

## Checklist (agent)

```
- [ ] Canonical path under docs/bugs or docs/opportunities
- [ ] Index tables match disk
- [ ] Grep BUG-NNN / OPP-NNN and old filenames; fix cross-references
- [ ] #fragment anchors: target file that still holds the heading
```

## Related

- [`docs/BUGS.md`](../../../docs/BUGS.md), [`docs/OPPORTUNITIES.md`](../../../docs/OPPORTUNITIES.md)
- [`ripmail/docs/BUGS.md`](../../../ripmail/docs/BUGS.md), [`ripmail/docs/OPPORTUNITIES.md`](../../../ripmail/docs/OPPORTUNITIES.md)
- [`../commit/SKILL.md`](../commit/SKILL.md) when finishing with a commit
