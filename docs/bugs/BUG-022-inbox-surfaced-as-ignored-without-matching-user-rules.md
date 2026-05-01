# BUG-022: Inbox mail surfaced as `ignore` when user rules do not explain it

**Status:** **Open (investigate).** A **human-relevant** message (e.g. an event invite) can be classified for `**inbox` / `ripmail inbox` output** as **ignored** even though the user’s visible `**rules.json`** (or equivalent) do **not** list the sender, domain, or an obvious pattern that would justify **ignore**—suggesting a **bug or implicit rule** rather than an intentional “do not show.”

## Summary

A reporter had an **invitation**-style message **not** appear in the **inbox** surface; it was **classified as ignored** while active rules did **not** name the sender or domain. The concern is **misclassification** (default heuristic, over-aggressive **ignore** path, or a **hidden/implicit** rule), not a user-edited “ignore this sender” rule.

**Same user pain theme as** “mail missing” as in [BUG-019](BUG-019-mail-visible-in-client-but-missing-from-search.md), but a **different mechanism**: BUG-019 is **search / `search_index` / category filters**; this bug is `**ripmail inbox`** (deterministic rules + evaluation) and **where** a message **lands in the triage/ignore** buckets.

## Related feedback

- In-app feedback issue **#9**, submitted **2026-04-24** (body redacted: invite misclassified to **ignore**; no matching **explicit** rules).
- **Submitter (hosted / multi-tenant):** tenant user id `**usr_zj9unkgrbbdapl022hwn`** (from issue **#9** YAML frontmatter `reporter`, via `GET /api/issues/9` with embed auth on the environment that received the report). The issue file does **not** include the workspace handle; on the server, read `**$BRAIN_DATA_ROOT/usr_zj9unkgrbbdapl022hwn/handle-meta.json`** and use the `**handle**` field (see `[handleMeta.ts](../../src/server/lib/tenant/handleMeta.ts)` / `[configuration.md](../architecture/configuration.md)`).

## Repro (from report, generalized)

1. Receive a message that the user **expects in inbox** (e.g. personal invite, RSVP).
2. Run `**inbox` / review** path or equivalent UI that reflects `**ripmail inbox`** classification.
3. **Observe** the message in `**ignore`** (or not in the positive set) when **rules** the user can see do **not** target that sender.
4. Compare with `**rules list`** (or on-disk `rules.json`) to confirm no deliberate **ignore** for that **From** / **domain** / **query**.

## Expected

- If the user has **no** matching **ignore** rule, the message should **not** be dropped into **ignore** by **silent** defaults that are not **visible, documented, and test-covered**.
- If **implicit** or **heuristic** rules exist, they should be **inspectable** (e.g. why ignored) for operator/debug flows so support does not assume user error.

## Hypotheses (investigate)


| Area                             | Note                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbox query vs rule ordering** | Mis-parse or over-broad `ignore` **query**; deterministic `ripmail inbox` + rules—confirm current pipeline in `[ripmail/AGENTS.md](../../ripmail/AGENTS.md)`. |
| **Category / heuristics**        | Parallels to **BUG-019** (e.g. `list` / other buckets) but for `**inbox` rows**, not search.                                                                  |
| **Multi-mailbox**                | Message under account or folder not included in the **inbox** window even though the user sees it in another client.                                          |


## Fix direction

1. **Reproduce** under a controlled `**RIPMAIL_HOME`** with the same `rules.json` and message characteristics (invites, `text/calendar`, etc.).
2. **Trace** `ripmail inbox` path for the **ignore** decision: rule ids, default queries, fallbacks.
3. **Deduplicate learnings** with [BUG-019](BUG-019-mail-visible-in-client-but-missing-from-search.md) only at the **“mail where user expects it”** narrative; keep **separate** root-cause and tests.

## References

- `ripmail` **`inbox`**, **rules** — `ripmail/AGENTS.md`; track **CLI/root-cause work** in **`docs/bugs/`** via [`docs/BUGS.md`](../BUGS.md) (same canonical index links from [`ripmail/docs/BUGS.md`](../../ripmail/docs/BUGS.md)); keep **`BUG-022`** here for **in-app** reports.