# Archived: OPP-061 — Wiki top-level directory icons (vault metadata)

**Status: Archived (2026-05-12).** Removed from the active backlog (shipped or no longer pursued).

**Stub:** [../OPP-061-wiki-top-level-dir-icons-vault-metadata.md](../OPP-061-wiki-top-level-dir-icons-vault-metadata.md)

---

## Original spec (historical)

### OPP-061: Wiki top-level directory icons — vault metadata + one-shot LLM pick

**Status:** Not started  
**Tags:** `wiki` · `ux` · `lucide` · `llm` · `metadata` · `local-first`  
**Related:** [OPP-060](../OPP-060-starter-wiki-templates-and-agent-authoring.md) (starter dirs / templates); [`src/server/routes/wiki.ts`](../../../src/server/routes/wiki.ts) (`GET /api/wiki/dir-icon/:dir`); [`src/client/lib/dirIcons.ts`](../../../src/client/lib/dirIcons.ts); [`shared/brain-layout.json`](../../../shared/brain-layout.json) (`dirIconsCache`); [AGENTS.md](../../AGENTS.md) (Lucide as components); [data-and-sync.md](../../architecture/data-and-sync.md)

---

## One-line summary

When a **new top-level** folder appears under the wiki vault, resolve its **Lucide icon once**, store it as **per-directory vault metadata** (dotfile), and **reuse that icon for all nested paths** under that folder — with an LLM step that sees **sibling folders and their icons** so the set stays visually distinct and on-brand.

---

## Problem

- Today, icons come from **hardcoded defaults** (`people` → `User`, etc.), then a **global JSON cache** under `BRAIN_HOME` (`wiki-dir-icons.json`), then a **small Haiku call** for unknown directory names ([`wiki.ts`](../../../src/server/routes/wiki.ts)).
- That model is **not vault-local**: caches are global to the machine, not checked into the wiki; **nested** directory names can still trigger **per-segment** API behavior on the client ([`dirIcons.ts`](../../../src/client/lib/dirIcons.ts) keys by full folder path in some flows — worth unifying with “top-level only”).
- When users **add new top-level areas** (e.g. `research/`, `finance/`), icons feel arbitrary or duplicate **without** global context (“what icons are already taken?”).
- **Deleted:** onboarding `categories.json` was **not** used for icons (see chat history); this OPP is the right place to specify **vault-scoped** icon behavior.

---

## Goals

1. **Top-level only:** Assign an icon **once per first path segment** (e.g. `people`, `projects`, `topics`, user-created `grants/`). Anything under `people/jane-doe/` uses **`people`’s** icon in sidebar/file rows — **no** per-nested-folder LLM or cache entries.
2. **Vault-resident metadata:** Store the choice **inside the wiki** (preferred: **dotfile** in that top-level directory) so it travels with backup, git, and multi-device sync. Example shape (TBD — keep tiny and versionable):

   ```json
   { "lucide": "Briefcase", "pickedAt": "2026-04-29T12:00:00.000Z", "source": "llm" }
   ```

   **Naming:** e.g. `.braintunnel-dir.json` or `.bt-wiki-dir.json` — final name should avoid colliding with Obsidian / other tools; document in [brain-layout.json](../../../shared/brain-layout.json) or ARCHITECTURE if promoted.
3. **One-shot LLM resolution** when the folder **first becomes real** (first `write` that creates `newdir/` or `newdir/index.md`, or explicit “ensure icon” pass). Prompt should include:
   - **Directory name** (and optional **human title** from `index.md` H1 if cheap to read).
   - **Allowlist** of Lucide icon names the **client can render** (must stay in sync with [`dirIcons.ts`](../../../src/client/lib/dirIcons.ts) `ICON_MAP` or codegen).
   - **Sibling context:** all **other top-level** dirs and their **current** icons (from dotfiles + built-in defaults for seeded folders) so the model can **prefer unused** icons and stay consistent with existing choices.
   - Instruction: pick **one** name from the allowlist; **avoid** duplicating siblings unless semantically forced; short rationale optional (discard before save).
4. **Deterministic fallback** if LLM fails: hash-based pick from allowlist or conservative `Folder` / `File` — never block saves.

---

## Non-goals

- **Per-nested-folder** icons (e.g. different icon for `people/alice` vs `people/bob`).
- **Automatic re-pick** on rename (optional follow-up: watcher or manual “refresh icon”).
- Replacing **file-type** or **special page** icons (`me.md`, `_` prefixed, root `index.md`) — those stay as today in [`WikiFileName.svelte`](../../../src/client/components/WikiFileName.svelte).
- **Ripmail** or non-wiki corpora.

---

## Proposed implementation sketch

### Server

- **Resolver order** for `GET /api/wiki/dir-icon/:dir` when `dir` is a **single segment** (top-level):  
  (1) built-in seed defaults for known starter dirs →  
  (2) read `{wikiRoot}/{dir}/.braintunnel-dir.json` (or agreed filename) →  
  (3) legacy `wiki-dir-icons.json` migration path (optional one-time copy into dotfiles) →  
  (4) enqueue / sync LLM pick, write dotfile, return icon.
- For **multi-segment** `dir` (e.g. `people/alice`): **strip to first segment** and resolve only that (client should align to avoid duplicate fetches).
- **Hook** on wiki `write`/`move` that creates a **new top-level** directory: `ensureTopLevelDirIcon(dirName)` (idempotent, guarded by dotfile existence).

### Client

- **`getDirIcon`:** For paths under a top-level folder, key cache by **first segment** only; stop calling API with full nested path.
- **Allowlist sync:** Single shared module or generated list consumed by server prompt validation and client `ICON_MAP`.

### Testing

- Unit: resolver prefers dotfile over global cache; nested path uses parent top-level icon.
- Integration: first write to `newdir/x.md` creates dotfile exactly once; second open does not call LLM again (mock).

---

## Migration / backwards compatibility

- **Optional:** On read, if global cache has an entry but dotfile missing, **copy into dotfile** and deprecate cache entry (reduce dual sources over time).
- Seeded starter dirs can ship **without** dotfiles initially and rely on **existing defaults** until user adds custom siblings (then LLM prompts still see defaults as “occupied” icon names).

---

## Validation criteria

- New top-level folder gets a **stable** icon without manual config.
- Icons for **nested** pages match their **root** folder icon in wiki chrome.
- Vault copied to another machine preserves icons **via dotfiles**.
- No unbounded LLM calls: **at most one** per new top-level directory.

---

## Open questions

- Exact **dotfile name** and whether to **gitignore** (recommend **commit** so team vaults stay consistent).
- Whether **hosted multi-tenant** needs rate limits on icon LLM calls (likely negligible vs chat).
- **Curated allowlist size** vs full Lucide catalog (client bundle and UX prefer a bounded set).
