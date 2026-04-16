# OPP-043: Inbox Bulk Clear — `inbox clear` (or equivalent) with `--except`

**Status:** Archived — not prioritized. **Archived:** 2026-04-10.

**Created:** 2026-04-05. **Tags:** inbox, cli, archive, agents, ergonomics

**Related:** [OPP-036 archived](OPP-036-inbox-triage-orthogonal-archive.md) (explicit **`ripmail archive`** vs triage), **`ripmail inbox`** / **`ripmail archive`** in [AGENTS.md](../../AGENTS.md), [`message_id_lookup_keys`](../../src/ids.rs) (bare vs bracketed Message-IDs)

---

## Problem

A common workflow is: **review inbox → handle/reply → clear the working set**, sometimes **keeping a few threads** open.

Today that means **`ripmail inbox …`** (JSON) → **compute which Message-IDs to archive** → **`ripmail archive <id> …`**. The primitive is correct; the **intent** (“archive everything in this inbox pass except these”) requires an extra complement step in the agent or a shell loop.

For typical **small** inbox windows (noise already filtered), the cost is mostly **correctness and clarity**, not tokens: one wrong ID in the complement list archives something the user wanted to keep.

---

## Proposed direction (design space)

Introduce a **single high-level command** that:

1. Reuses the **same scope semantics** as **`ripmail inbox`** for a given run: rolling **`window`** / **`--since`**, **`--mailbox`**, and the same **fast vs thorough** behavior (whatever the product chooses as default for “clear”).
2. Archives **all messages that would appear in that inbox candidate set** (or a clearly documented subset, e.g. only `notify`+`inform` rows) **except** Message-IDs listed via **`--except`**.
3. Delegates the actual state change to the same code path as **`ripmail archive`** (local **`is_archived`** + optional provider mutation when enabled).

**Naming (preference):** Scope under **`inbox`** (e.g. **`ripmail inbox clear --except …`**) so it is obvious the operation is tied to the **inbox scan**, not a vague root-level **`ripmail clear`**.

**Alternative:** Repeatable **`--except`** or **multiple trailing Message-IDs** instead of comma-separated lists, to avoid delimiter edge cases; if comma-separated is supported, document **shell quoting** when IDs include **`<`/`>`** (bare IDs from JSON usually do not).

---

## Agent / human value

- **Agents:** Marginal token savings for small lists; main benefit is **one explicit operation** matching user intent and fewer **complement** mistakes.
- **Humans:** Faster mental model (“clear my inbox except these”) when scripting.

---

## Acceptance criteria (if implemented)

- [ ] Behavior and flags are **documented** next to **`ripmail inbox`** and **`ripmail archive`** (single source of truth in **AGENTS.md** + `--help`).
- [ ] Integration tests cover: empty except list (clear all in scope), multiple except IDs, **bare** and **bracketed** Message-ID forms consistent with **`message_id_lookup_keys`**.
- [ ] JSON stdout shape is consistent with **`ripmail archive`** (or a strict superset) so agents can parse results uniformly.
- [ ] Clear errors when no messages match, or when an **`--except`** id is unknown (product decision: warn vs fail).

---

## Non-goals / out of scope

- Replacing **`ripmail archive`** for **explicit** per-id archive (keep the low-level primitive).
- Automatic migration or backward-compat layers beyond the repo’s **early-dev** norms ([AGENTS.md](../../AGENTS.md)).
