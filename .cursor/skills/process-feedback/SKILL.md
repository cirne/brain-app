---
name: process-feedback
description: >-
  Lists and fetches in-app product feedback (embed key + npm), skips already-triaged ids via
  docs/feedback-processed/registry.md, then promotes items into docs/bugs or opportunities—or
  augments an existing BUG/OPP. Records each completed triage in the registry. Use for /process-feedback,
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

## Workflow

1. **Registry** — Note ids in `registry.md` **to skip**; for remaining ids from `issues:list`, continue.
2. **Fetch** each unprocessed `id` with `issues:fetch -- <id>`. Read Summary, Repro, and front matter.
3. **Search the backlog** — Skim **`docs/BUGS.md`** and **`docs/OPPORTUNITIES.md`**, grep `docs/bugs/`, `docs/opportunities/` (and `ripmail/docs/` if CLI-only — see [backlog skill](../backlog/SKILL.md) ownership).
4. **Branch**
   - **Existing BUG/OPP** matches the same problem: edit that file; add **User feedback** / **Additional reports** with the feedback **id**, date, and any new useful detail. Optionally tweak the index one-liner.
   - **No match** — new **`docs/bugs/BUG-NNN-slug.md`** or **`docs/opportunities/OPP-NNN-slug.md`** + index row. Include a **Related feedback** line: issue **#N** and date (no server paths, no embed key).
5. **Register** — Append a **row** to [`docs/feedback-processed/registry.md`](../../../docs/feedback-processed/registry.md):
   - Feedback issue id, submitted time from the report, **Tracked as** (e.g. `BUG-018` with link, or "see **Bug …** section in [file](…)" if only appended to an existing doc), and **Processed** date (UTC).
6. This step is **required** when triage is complete; it is how the next person knows the issue was handled.

## Id choice and ownership

- Next **`BUG-NNN` / `OPP-NNN`**: [backlog skill](../backlog/SKILL.md) (smallest unused in tree).
- Ripmail-only reports → `ripmail/docs/bugs` or `…/opportunities` and **also** add a row to `docs/feedback-processed/registry.md` (same in-app id).

## What not to commit in docs

- Server filesystem paths, session cookies, or **`BRAIN_EMBED_MASTER_KEY`**. Reference in-app work by **feedback issue id** and **BUG-OPP id** only.

## See also

- [feedback-processed README](../../../docs/feedback-processed/README.md)
- [backlog skill](../backlog/SKILL.md)
- `AGENTS.md` (OPP-048)
