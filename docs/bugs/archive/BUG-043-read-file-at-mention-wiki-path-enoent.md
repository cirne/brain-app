# BUG-043: `read_file` / read wiki tool fails for **@‑referenced** wiki paths (ENOENT under `wikis/`)

**Status:** Fixed (2026-05-05). Wiki paths are **`wikis/`-relative everywhere** (`me/…` for the personal vault tree, `@handle/…` for shared projections). Listing, HTTP CRUD, chat `context.files`, and agent FS tools share one resolution rule; legacy vault-only strings (`ideas/foo.md`) are normalized to `me/ideas/foo.md` at API/router boundaries where appropriate; wiki tool errors are sanitized so absolute tenant paths never leak (`sanitizeWikiFilesystemToolError`, `wikiScopedFsTools.ts`). Mentions: **`@me/…`** for personal pages, **`@alice/shared.md`** preserved for peer paths (`extractMentionedFiles`, `AgentInput` insert).

---

## Symptoms (historical)

- User cites **`@travel/…`** (or legacy **`@`** without `me/`) in chat; the model calls **read** with `travel/…`.
- **ENOENT** under `…/wikis/travel/…` while the file opens in the UI under **`wikis/me/…`**.

---

## Root cause

**Two effective roots for the same string:** `GET /api/wiki` listed files from **`wikiDir()`** (`wikis/me/`), so paths omitted the **`me/`** segment. Tools used **`wikiToolsDir()`** as cwd and treated each segment as directly under `wikis/`, so **`travel/foo.md`** resolved to **`wikis/travel/foo.md`** instead of **`wikis/me/travel/foo.md`**.

---

## Fix summary

| Area | Change |
|------|--------|
| Wiki routes | List + resolve under **`wikiToolsDir()`**; personal mutations require **`me/`** prefix; edit history paths unified. |
| Chat | **`context.files`** validated against **`wikiToolsDir()`**. |
| Client router | **`toUnifiedPersonalWikiPath`**, **`normalizeWikiOverlayQueryPath`**; pathname **`/wiki/me/…`** maps to overlay paths **`me/…`**. |
| Mentions | **`extractMentionedFiles`**: `@me/…` and `@handle/…`; **`insertMention`** normalizes `@` prefix. |
| Security / UX | **`wikiToolFsErrors.ts`** + tests; no raw fs paths in tool failure text. |

Tests: `wiki.test.ts`, `router.test.ts`, `wikiDirListModel.test.ts`, `wikiToolFsErrors.test.ts`, `agentUtils.test.ts`, `AgentInput.test.ts`.

**Related:** [BUG-040](../BUG-040-wiki-chat-overlay-shared-doc-open-fails.md), [BUG-042](../BUG-042-agent-search-shared-docs-not-labeled-confuses-model.md).
