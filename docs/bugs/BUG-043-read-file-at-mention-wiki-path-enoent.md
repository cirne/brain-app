# BUG-043: `read_file` / read wiki tool fails for **@‑referenced** paths (ENOENT under `wikis/`)

**Status:** Open  
**Severity:** P1 (breaks chat attachments and cited paths; user-visible hard failure)  
**Related:** [BUG-040](BUG-040-wiki-chat-overlay-shared-doc-open-fails.md), [BUG-042](BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md)

---

## Symptoms

- User cites a wiki file in chat, e.g. **`@travel/2026-05-03-virginia-beach.md`**, and asks a follow-up (“when do we fly home?”).
- The assistant invokes **read file** with a **relative path** such as `travel/2026-05-03-virginia-beach.md`.
- The operation fails with **`ENOENT: no such file or directory`** when opening the resolved path under the tenant wiki root, e.g.:

  `/brain-data/<tenant>/wikis/travel/2026-05-03-virginia-beach.md`

- Reporter observation: **opening by this kind of reference/name appears to fail consistently** (path resolution or namespace mismatch), not an intermittent race.

**Evidence (2026-05-04):** screenshot in local assets — user message with `@travel/…`, tool call path `travel/…`, red error with full `…/wikis/travel/…` ENOENT.

---

## Expected

- **`@…` mentions** and agent tool paths resolve to the **same on-disk / API semantics** as the wiki browser (vault-relative vs `me/` vs `@handle/…` per unified namespace).
- If the file exists where the UI can open it, **read file succeeds** or returns a **clear, actionable** error (wrong tenant, shared-only, moved) — not a silent wrong prefix join.

---

## Hypothesis / fix direction

- **Mismapped context:** strip or mishandle **`@` / unified prefix** so the tool joins **`wikis/<first segment>/…`** incorrectly (e.g. `travel` treated as top-level folder under `wikis/` when the real layout differs, or file actually under another projection).
- **Verification:** reproduce with a known file that opens in the wiki viewer; capture server log path + `stat`; align path builder between **mention injection**, **agent tools**, and **`GET /api/wiki/...`**.
