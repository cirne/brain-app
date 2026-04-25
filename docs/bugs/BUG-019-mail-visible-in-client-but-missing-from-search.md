# BUG-019: Inbox-visible message missing from Brain search / index

**Status:** **Open (unresolved).** Staging still cannot surface the expected mail with normal assistant search (e.g. domain-wide or name-based queries); local investigation narrowed likely causes but product behavior is unchanged.

## Summary

A message the user can see in their **mail client inbox** (example report: from a **New Relic** contact, received about **two days** before the report) does **not** appear when they **search in Brain** by sender name and/or domain. Only other traffic from the same domain (e.g. automated mail) may show up, which suggests a **per-message** gap—not a total account or search outage.

The reporter wonders whether the message was **discarded**, treated as **spam**, or **hidden by default rules** on our side.

## Related feedback

- In-app feedback issue **#2**, submitted **2026-04-24** (title: email from named sender not found; possible incorrect filtering).
- In-app feedback issue **#9**, submitted **2026-04-24** — *different mechanism*: [BUG-022](BUG-022-inbox-surfaced-as-ignored-without-matching-user-rules.md) (**inbox** `ignore` vs this bug’s **search** / default category / index). Same “mail not where I expect it” user story.

## Repro (from report)

1. Identify a specific recent inbound message that is visible in the user’s inbox in their mail app.
2. In Brain, search by **sender** and/or **expected domain**.
3. Observe **no** hit for that message even though it should match.
4. Optionally compare with what **does** appear for broader queries on the same domain.

## Expected

- If a message is **indexed and not excluded by product rules**, search by sender or domain should surface it (subject to normal FTS / ranking limits, but not total absence of a clear match).
- If a message is **intentionally excluded** (e.g. spam bucket, trash, filtered folder, or inbox rules), the product should either index it consistently with that policy or make the exclusion **visible and explainable** so users do not assume data loss.

## Investigation so far (2026-04)

| Where | Finding |
| ----- | ------- |
| **Local dev** (`RIPMAIL_HOME` under `data/ripmail`) | The reported-class message **exists** in SQLite and **`document_index_fts`**: New Relic “contact sales” follow-up from **`hharriss@newrelic.com`** (display **Hunter Harriss**, two **`s`**), **`category: list`**. It **does not** appear under default **`ripmail search`** because ripmail applies **`default_category_filter_sql`** — **`list`** (and several other buckets) are **excluded** unless **`--include-all`** or an explicit **`--category`** includes those values. **`search_index`** in Brain does **not** pass **`--include-all`** (see `buildRipmailSearchCommandLine` in `src/server/agent/tools.ts`). Free-text **`Hunter Harris`** (one **`s`**) also fails regex-on-body vs **Harriss** unless the model uses the right spelling or filters. |
| **Staging** | User confirms the mail remains **not findable** with realistic assistant queries (e.g. anything **@newrelic.com**, or **`Harris`** + **`after: 180d`**): no New Relic hit. Treat as **still broken for users** until default search semantics or tooling change. |

**Likely primary cause (product):** “Search my mail” assumes **everything indexed is searchable**, but **default ripmail search hides whole categories** (`list`, `promotional`, `automated`, etc.). Many vendor domains are entirely or mostly in those buckets, so **domain-wide search can return nothing** while Mail.app still shows the message in Inbox.

Secondary: **no in-app tool** documents or exposes **`ripmail rebuild-index`**; staging **index health** (stale DB vs local Mail) not ruled out for that environment.

## Hypotheses (investigate)

| Area | Why it could explain “in Mail but not in Brain” |
| ---- | ----------------------------------------------- |
| **Default search category filter** | **`list` / promotional / automated** rows excluded — matches local repro; explains empty **@domain** search if all matching mail is bucketed there. |
| **Sync / scope** | Message never copied into the slice ripmail indexes on **staging** (folder, account, sync lag, or wrong `RIPMAIL_HOME`). |
| **Inbox rules / `inbox` determinism** | `rules.json` or pipeline affects **inbox** surfacing; **search** is separate but user may conflate the two. |
| **Spam or junk handling** | Message in a folder or label path not fully mirrored into the indexed corpus. |
| **Indexing bug / drift** | FTS or SQLite out of sync with maildir until **`rebuild-index`** or **`refresh`**. |
| **Search query semantics** | Wrong local-part (**`hharris`** vs **`hharriss`**), date window, or missing **`category`** on **`search_index`**. |

## Fix direction

1. **Product / ripmail:** Decide whether **default search should exclude categories** at all for assistant / “find my email” flows — or expose **`--include-all`** (or equivalent) on **`search_index`**, with clear UX when results are filtered.
2. **UX:** When zero results, hint that **marketing/list** mail may be hidden unless the user widens category or uses an explicit control.
3. **Staging ops:** For the affected tenant, try **`ripmail rebuild-index`** (or full **`refresh`**) under the correct **`RIPMAIL_HOME`** and re-test search.
4. **Tooling:** Consider an operator or advanced **rebuild-index** tool/skill (guardrails: destructive/slow; Apple Mail vs IMAP implications per **`ripmail/AGENTS.md`**).

## Next steps (later)

- Try **rebuilding the index** for the **staging** user (correct tenant **`RIPMAIL_HOME`**, then **`ripmail rebuild-index`** or aggressive **`refresh`** as appropriate).
- Consider adding a **tool or documented skill** to run **`rebuild-index`** safely (when, risks, Apple Mail maildir vs IMAP).
- **Revisit default rules:** consider indexing **everything** into FTS and relying on **narrower queries or post-filters** instead of excluding whole categories from default search — trade-off: noisier default results vs “I searched my email and got nothing.”

## References

- `ripmail` CLI: `search`, `inbox`, `rebuild-index`, `refresh` — [`ripmail/AGENTS.md`](../../ripmail/AGENTS.md); [`ripmail/docs/BUGS.md`](../../ripmail/docs/BUGS.md) if a companion ripmail bug is filed.
- Default excluded categories: [`ripmail/src/mail_category.rs`](../../ripmail/src/mail_category.rs) (`DEFAULT_EXCLUDED_CATEGORIES`, `default_category_filter_sql`).
- Agent tools: `search_index` — [`docs/architecture/integrations.md`](../architecture/integrations.md), `src/server/agent/tools.ts` (`buildRipmailSearchCommandLine`).
