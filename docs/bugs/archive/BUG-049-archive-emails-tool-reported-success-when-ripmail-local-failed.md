# BUG-049: `archive_emails` — assistant text claimed “Archived N” when ripmail reported `local.ok: false`

**Status:** Fixed (2026-05-09). In-app feedback **#17** closed as fixed.  
**Tags:** `mail` · `agent-tools` · `inbox`  

**Related:** [BUG-039 archived](BUG-039-archive-leading-dash-message-id-parsed-as-cli-flag.md) (different mechanism — CLI flag parsing on peculiar `Message-ID`s).

---

## Summary

`archive_emails` delegated to `ripmailArchive`, which can return per-message results with **`local.ok: false`** (id did not resolve, archive no-op) while the CLI still exits successfully. An earlier implementation surfaced **“Archived N message(s)”** from the **requested** id count instead of the **succeeded** count, so the model and user believed mail left the inbox when it had not.

---

## Fix

[`src/server/agent/tools/ripmailAgentTools.ts`](../../../src/server/agent/tools/ripmailAgentTools.ts) — derive **`archived`** from `results.filter(r => r.local.ok)` and set **`ok: false`** when any id fails; user-visible text distinguishes **all failed** vs **partial** success.

**Regression:** [`src/server/agent/tools.test.ts`](../../../src/server/agent/tools.test.ts) — `archive_emails tool — unresolved ids`.

---

## User feedback

- In-app issue **#17** (`2026-05-09`) — assistant reported **30** archived; next **`list_inbox`** / triage still showed the **same 30** surfaced items.
