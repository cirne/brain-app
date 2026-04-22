---
name: backlog
description: Maintains brain-app bug and opportunity hygiene—reconciles docs with code, archives completed work, files new items, and updates docs/BUGS.md, docs/OPPORTUNITIES.md, and ripmail indices. Use when the user invokes /backlog, asks to triage bugs or opportunities, review the backlog, archive fixed issues, or align tracking docs with reality.
---

# Backlog (bugs & opportunities)

The repo tracks work in **markdown files** plus **index tables** in `docs/BUGS.md`, `ripmail/docs/BUGS.md`, and `docs/OPPORTUNITIES.md`. Ripmail uses a **separate** `BUG-*` / `OPP-*` ID namespace under `ripmail/docs/`.

## When to run this

- Periodic **hygiene**: active lists match shipped code; fixed items are not left in `bugs/` (non-archive) with “**Status: fixed**” in the file body.
- **Close / archive** a bug or OPP that is done, superseded, or “closed enough” for a stated scope (e.g. staging good for N users; remaining phases deferred).
- **File** a new bug or opportunity with the right path and the index updated.
- **Split** a big OPP: archive the old narrative, add a new OPP (or new bug) for what is still open.

## Where things live

| Kind | brain-app (Hono, Svelte, Tauri shell, integration) | ripmail (Rust CLI, index, sync) |
|------|------------------------------------------------------|-----------------------------------|
| Active bugs | `docs/bugs/BUG-NNN-….md` | `ripmail/docs/bugs/BUG-NNN-….md` |
| Archived bugs | `docs/bugs/archive/` | `ripmail/docs/bugs/archive/` |
| Bug index | `docs/BUGS.md` | `ripmail/docs/BUGS.md` |
| Active opportunities | `docs/opportunities/OPP-NNN-….md` | `ripmail/docs/opportunities/` (separate numbering) |
| Archived opportunities | `docs/opportunities/archive/` | `ripmail/docs/opportunities/archive/` |
| OPP index | `docs/OPPORTUNITIES.md` (+ `ripmail/docs/OPPORTUNITIES.md` for the crate) | same |

**Convention:** The next id is the **smallest unused integer** in that tree (see existing files); don’t reuse numbers.

## Hygiene: doc vs code

1. **Read the index** (`BUGS.md` / `OPPORTUNITIES.md` / ripmail equivalents) and scan **non-archive** files for a **`**Status:`** (or “Implemented”, “Fixed”, “Shipped”, “Won’t fix”) that contradicts “open” in the index.
2. For **suspected done**: confirm in the codebase (grep for removed feature, or ask for the fixing commit) before archiving.
3. For **suspected stale** (“future” in doc but long shipped): update the body or add an archive banner, then **move** the file; fix **all** in-repo links (grep the bug/OPP id).
4. **Security or multi-tenant items** (e.g. path policy): if “fixed” only means **app-layer** mitigation, the doc can stay **open** with a table of what shipped vs what remains (OS-level isolation, etc.).

## New bug

1. Pick **tree**: brain-app vs ripmail (see the intro in `docs/BUGS.md` for ownership).
2. **Filename:** `docs/bugs/BUG-NNN-short-slug.md` (or under `ripmail/docs/bugs/`).
3. **Content (minimum):** title `# BUG-NNN: …`, short **Summary** / **Symptom**, **Repro** or **Evidence** if known, **Expected**, **Status:** Open, optional **Severity:** / **Tags:**.
4. **Index:** add a row to the **Active** table in the matching `BUGS.md` with a one-line summary and link to the file.
5. If the issue spans app + ripmail, file in one place and **cross-link** (or file two bugs with `Related:` in each).

## New opportunity (OPP)

1. **Filename:** `docs/opportunities/OPP-NNN-short-slug.md` (brain-app numbering is independent of ripmail OPPs).
2. **Content:** problem, motivation, proposed direction, **Non-goals** if helpful, **Related:** links, **Status** (open / partial / future).
3. **Index:** add a row to **Active** in `docs/OPPORTUNITIES.md` (or the **Will not do** / **Implemented** section if you are immediately closing it—prefer rare; usually start in Active).
4. Link out to **architecture** or **runbooks** instead of duplicating long specs.

## Close and archive a bug (fixed or won’t fix)

1. Set final **`**Status:`** in the file** (e.g. **Fixed (YYYY-MM-DD).** with pointers to code or tests) or **Won’t fix** with rationale and superseding doc/OPP.
2. **`git mv`** the file to `…/bugs/archive/`.
3. **Update the index table**: move the row from **Active** to **Fixed (archived)** in `BUGS.md`, and point the link at `bugs/archive/…`.
4. **Grep** the repo for `BUG-NNN` and `old-path` and **fix links** (including `GMAIL_*.md`, `packaging-and-distribution.md`, skills, archived opps, etc.).

## Close and archive an opportunity

**Fully shipped or obsolete narrative**

- Prepend a short **Archived:** block at the top (status, date, one-line “why closed”), or fold that into the first heading per existing archive docs.
- **`git mv`** to `docs/opportunities/archive/OPP-NNN-….md`.
- **Update links** in moved files: paths gain one `../` level for `docs/…`, `../architecture/…`, and repo-root paths (`../../../` for things like `docker-compose` from `opportunities/archive/`). A small script that prefixes `../` to each relative `](…)` target is one reliable approach; spot-check a few links.
- **Index:** in `OPPORTUNITIES.md`, move the row to **Implemented** (or **Will not do**) with a short summary; link the row to a **stub** in `docs/opportunities/OPP-NNN-….md` if you want a stable short URL, plus “full doc:” `archive/…` (see below).

**“Mostly done” / epics (defer remaining phases)**

- Add an honest **Status:** (e.g. “Closed for current scale: ~10–50 users; Phases 3–4 deferred; reopen when…”). Archive the long doc; keep a **stub** at `docs/opportunities/OPP-NNN-….md` pointing to the archive for deep links and **anchors** (e.g. `#reference-…-checklist` must live in the full file, not the stub).
- If residual work is non-trivial, add a **new** OPP or bug for the deferred slice so the backlog does not look “closed” in the index with hidden work.

**Stubs (optional, stable links)**

- Short file at the old top-level name: “moved; full spec in [archive/…](archive/…).”
- **Deep links** from other docs (checklists, `digitalocean.md`) should target **`opportunities/archive/OPP-….md#anchor`**, with “stub” called out in prose where helpful.

**Tags and priority (optional)**

- For work that is **native macOS / Tauri / bundled**-centric, you can add e.g. `**Tags:** desktop` and one line: **Short-term priority:** cloud vs desktop—so triage does not relitigate every quarter.

## Splitting in-progress / umbrella items

- **Archive** the old doc (superseded narrative).
- **New file** for the open remainder with a new id; link **Supersedes** / **Related:** to the archive path.
- Update indices so one row does not claim both “done” and “remaining” without explanation.

## Checklist (agent)

```
- [ ] Correct tree (brain-app vs ripmail) and id chosen
- [ ] File moved with git (mv), not a copy that orphans the old path
- [ ] Index tables (BUGS / OPPORTUNITIES) match files on disk
- [ ] Grep for ID and old path; update cross-references
- [ ] Stubs/anchors: anything with #fragment points at the file that still contains the heading
```

## Related

- [`docs/BUGS.md`](../../../docs/BUGS.md), [`docs/OPPORTUNITIES.md`](../../../docs/OPPORTUNITIES.md)
- [`ripmail/docs/BUGS.md`](../../../ripmail/docs/BUGS.md) and [`ripmail/docs/OPPORTUNITIES.md`](../../../ripmail/docs/OPPORTUNITIES.md)
- [`../commit/SKILL.md`](../commit/SKILL.md) when finishing with a commit
