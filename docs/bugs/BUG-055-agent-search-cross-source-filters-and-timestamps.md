# BUG-055: Agent / unified search omits sources when mail-style filters don’t apply

**Status:** **Open (tracking).** Requires product + engineering design; behavior today can silently drop whole corpora (e.g. indexed Drive files) when the model passes parameters that only mail understands.

## Summary

When the assistant calls the search tool with **mail-centric** fields—examples include **`from`**, **`since`** / date windows, or similar—the implementation may **not run the query against sources that cannot interpret those predicates**. Indexed **Google Drive** (and possibly other non-mail backends) may then be **skipped entirely**, even when the **free-text query** would match file names or body content.

Users and the agent both expect **“search everything I’ve indexed”** unless explicitly scoped. Today, optional filters meant to narrow **email** can become an accidental **hard exclusion** of other indexed material.

## Symptom

- Agent provides e.g. **`from:`** or a **time range** appropriate to **message arrival**.
- **Mail** may be searched with those constraints.
- **Drive / documents** (no sender, different date semantics) contribute **no results** — not because nothing matched, but because the search path **never attempted** those sources with a degraded or remapped query.

## Expected

- **Minimum:** If a source **does not support** a filter, **still run** the search on that source using **supported** dimensions (at least **full-text / query string**), and merge or rank results—do not **omit** the source solely because `from` / `since` is meaningless there.
- **Better:** A **documented global search contract**: one entry point with **per-source capability** (which filters apply) and **explicit** behavior when filters are partial (warn, strip, or map—see below).
- **Timestamps:** A **canonical way to map “when”** across sources—e.g. email **received / sent** time vs file **created / modified** time—so a user-facing **“since last week”** can apply sensibly to **mail and files** without requiring the agent to issue different tools.

## Non-goals (for this ticket)

- Perfect ranking across heterogeneous sources (can follow from the same design).
- Changing default mail category filters ([BUG-019 archived](archive/BUG-019-mail-visible-in-client-but-missing-from-search.md))—related “missing hits” story but different mechanism.

## Fix direction (open)

1. **Audit** search entrypoints (`search_index`, ripmail search, Drive/indexed-file search) for **early returns** when optional args are present but unsupported.
2. **Define** per-source **filter matrix** (supported / ignored / mappable) and implement **strip-or-map** with logging or tool metadata so the agent knows what was applied.
3. **Consider** a single **global search** path that always fan-outs on the text query and applies **source-specific** filter translation (e.g. `since` → mail date column vs Drive `modifiedTime`).
4. **Document** for agents/skills: which parameters narrow mail vs universal text.

## Related

- [BUG-019 archived](archive/BUG-019-mail-visible-in-client-but-missing-from-search.md) — mail category / default filters hiding indexed messages.
- Code touchpoints likely include `src/server/ripmail/search.ts`, agent mail/search tools, and any indexed-Drive search path wired into `search_index`.
