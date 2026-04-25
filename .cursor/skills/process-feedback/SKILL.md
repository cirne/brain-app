---
name: process-feedback
description: >-
  Lists and fetches in-app product feedback (embed key + npm), skips already-triaged ids via
  docs/feedback-processed/registry.md, then promotes items into docs/bugs or opportunities—or
  augments an existing BUG/OPP. Park deferred items in docs/feedback-processed/deferred.md. Records
  each completed triage in the registry. Use for /process-feedback, /process-feedback triage,
  feedback queue → backlog, or "process staging issues."
---

# Process feedback (in-app issues → backlog)

User-submitted feedback is stored on the server as **issue** files (see `src/server/lib/feedbackIssues.ts`, `AGENTS.md` OPP-048). This skill is for **operators** moving that queue into **`docs/bugs/`** or **`docs/opportunities/`** and **recording** what was done so work is not duplicated.

## Prereqs

- **`BRAIN_EMBED_MASTER_KEY`** in the environment (same value the server uses).
- **`PUBLIC_WEB_ORIGIN`** set to the app base URL (e.g. `https://staging.braintunnel.ai` or local).
- Run from the **brain-app** repo root so `npm run issues:*` resolves.

## Check what is already triaged (do this first)

1. Open **[`docs/feedback-processed/registry.md`](../../../docs/feedback-processed/registry.md)**.
2. Any **Feedback issue id** already in the table is **done** — do not re-file the same report unless you are **re-triaging** (then update the existing BUG/OPP instead of a new row).
3. If this folder is missing, read [`docs/feedback-processed/README.md`](../../../docs/feedback-processed/README.md) and create `registry.md` with the table header if needed.

## Fetch the queue

```bash
set -a && [ -f .env ] && . ./.env && set +a
export PUBLIC_WEB_ORIGIN="https://staging.braintunnel.ai"   # or your target
npm run issues:list
```

```bash
npm run issues:fetch -- <id>    # JSON: content, id, no secrets required in repo
```

Use `issues[].id`, `title`, `type`, and the fetch payload’s markdown `content` (front matter: optional `reporter`, `createdAt`).

## Triage mode (`/process-feedback triage`)

Use this when the operator wants a **pass over the full queue** with **deduplication, backlog search, and take vs defer** before (or instead of) immediately filing every doc. **Execute the steps below in order** unless the user only asked for a subset.

1. **Registry** — Load [`registry.md`](../../../docs/feedback-processed/registry.md); treat listed ids as **already handled** (do not re-triage the same id unless the user is updating prior decisions).
2. **`issues:list` + `issues:fetch`** — For every id **not** in the registry, fetch full content.
3. **Backlog search** — For each item, grep/skim `docs/BUGS.md`, `docs/OPPORTUNITIES.md`, `docs/bugs/`, `docs/opportunities/`, and `ripmail/docs/` when the report is **mail/CLI** (see [backlog skill](../backlog/SKILL.md) for ownership). Determine **duplicate** vs **new**.
4. **Deduplicate / merge**
   - If an existing **BUG/OPP** matches: **edit that file**; add or extend **Related feedback** / **Additional reports** with feedback **#id**, **date**, and new detail. Update the **index** one-liner in `BUGS.md` / `OPPORTUNITIES.md` if the story changed.
   - If the *symptom* is similar but the **mechanism** differs (e.g. **search** vs **`inbox` ignore**), **do not merge** into one root-cause doc—cross-link the bugs and state the distinction (see **BUG-019** vs **BUG-022** pattern).
5. **Take vs defer** — For each unprocessed id without a home yet:
   - **Take (file now):** new `docs/bugs/BUG-NNN-*.md` and/or `docs/opportunities/OPP-NNN-*.md` + index row in `docs/BUGS.md` or `docs/OPPORTUNITIES.md`. Next id: [backlog skill](../backlog/SKILL.md) (smallest unused in tree).
   - **Defer (park):** add or update a row in [`docs/feedback-processed/deferred.md`](../../../docs/feedback-processed/deferred.md) (short **title**, **why deferred**, **revisit** hint). **Still register** the feedback id in [`registry.md`](../../../docs/feedback-processed/registry.md) with **Tracked as** → link to `deferred.md` (or a specific anchor) so the next `issues:list` run does not re-triage it blindly.
6. **Register** — Append a **row** per **newly triaged** id to [`registry.md`](../../../docs/feedback-processed/registry.md) (id, submitted time from report, Tracked as, Processed **UTC** date). Filed **BUG/OPP** → link the doc; **deferred** → link `deferred.md` with a **short label** in the row text; **Won’t do** → state that in Tracked as with date (no empty rows).
7. **Optional** — If the user asked for a **summary table**, present: feedback id, title, **Tracked as** (BUG/OPP / deferred), and **recommendation** (take on vs defer) for their confirmation. After they concur, perform steps **4–6** for any item still not filed or parked.

## Workflow (default — single-item or promote)

1. **Registry** — Note ids in `registry.md` **to skip**; for remaining ids from `issues:list`, continue.
2. **Fetch** each unprocessed `id` with `issues:fetch -- <id>`. Read Summary, Repro, and front matter.
3. **Search the backlog** — Skim **`docs/BUGS.md`** and **`docs/OPPORTUNITIES.md`**, grep `docs/bugs/`, `docs/opportunities/` (and `ripmail/docs/` if CLI-only — see [backlog skill](../backlog/SKILL.md) ownership).
4. **Branch**
   - **Existing BUG/OPP** matches the same problem: edit that file; add **User feedback** / **Additional reports** with the feedback **id**, date, and any new useful detail. Optionally tweak the index one-liner.
   - **No match** — new **`docs/bugs/BUG-NNN-slug.md`** or **`docs/opportunities/OPP-NNN-slug.md`** + index row. Include a **Related feedback** line: issue **#N** and date (no server paths, no embed key).
5. **Register** — Append a **row** to [`docs/feedback-processed/registry.md`](../../../docs/feedback-processed/registry.md):
   - Feedback issue id, submitted time from the report, **Tracked as** (e.g. `BUG-018` with link, or "see **Bug …** section in [file](…)" if only appended to an existing doc), and **Processed** date (UTC).
6. This step is **required** when triage is complete; it is how the next person knows the issue was handled.

## Deferred items

- **Parking lot:** [`docs/feedback-processed/deferred.md`](../../../docs/feedback-processed/deferred.md) — reasons and revisit notes for ids **not** yet a BUG/OPP.
- **Registry** must still list those feedback ids (point at `deferred.md`) so **deduplication** and **`issues:list`** line up with the backlog.
- When an item is **promoted** from deferred to a real BUG/OPP, **update** the `registry.md` **Tracked as** link, **remove** the row from `deferred.md` (or add a one-line "promoted" note with target id).

## Id choice and ownership

- Next **`BUG-NNN` / `OPP-NNN`**: [backlog skill](../backlog/SKILL.md) (smallest unused in tree).
- Ripmail-only reports → `ripmail/docs/bugs` or `…/opportunities` and **also** add a row to `docs/feedback-processed/registry.md` (same in-app id).

## What not to commit in docs

- Server filesystem paths, session cookies, or **`BRAIN_EMBED_MASTER_KEY`**. Reference in-app work by **feedback issue id** and **BUG-OPP id** only.

## See also

- [feedback-processed README](../../../docs/feedback-processed/README.md)
- [backlog skill](../backlog/SKILL.md)
- `AGENTS.md` (OPP-048)
