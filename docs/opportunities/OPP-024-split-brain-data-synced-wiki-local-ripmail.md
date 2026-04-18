# OPP-024: Split Brain data — synced wiki (Documents / iCloud) vs local Application Support (ripmail, secrets, cache)

## Summary

Move from a **single `BRAIN_HOME` tree** ([OPP-012](OPP-012-brain-home-data-layout.md)) to a **deliberate two-root layout** on macOS: **user-facing, agent-primary knowledge** lives under **`~/Documents/…`** so it participates in **Desktop & Documents → iCloud** when the user has enabled that; **everything else** (especially **ripmail** — SQLite index, sync state, **OAuth artifacts**) stays under **`~/Library/Application Support/Brain`**.

**Intent:** Treat the **wiki as the cross-machine source of truth** for the assistant; treat **email as a local cache** that **rebuilds** from IMAP/Gmail on each Mac (delayed catch-up is acceptable for queries that depend on mail). **Goal:** when we implement this, **directory decisions should be stable** — minimal churn for users and docs.

**Status:** Opportunity (not implemented).

---

## Motivation

- [OPP-012](OPP-012-brain-home-data-layout.md) already notes that **ripmail’s SQLite under `RIPMAIL_HOME` is a poor fit for naive iCloud Drive sync** (concurrent writers, conflict copies). A single root under Application Support avoids accidental “sync the DB” while also **not** giving users **wiki sync** “for free” via iCloud.
- The product thesis here: **the agent’s primary working set is the wiki**; mail and other indexes are **inputs** that can **lag** on a second machine until sync/connect catches up.
- **Separating roots** encodes that semantics: **markdown + small JSON** in the iCloud-backed Documents tree; **databases, caches, credentials** outside it.

---

## Proposed layout (conceptual)

| Location | Contents | Rationale |
| -------- | -------- | --------- |
| **Documents (synced when iCloud Desktop & Documents is on)** | **`wiki/`** (markdown — primary knowledge)** | Syncs reliably as plain files; agent source of truth across Macs. |
| Same tree (optional) | **Chat history**, **ripmail `rules.json`**, other **non-secret** preferences as small JSON | Cross-machine continuity for conversations and deterministic inbox rules; same sync story as wiki. |
| **`~/Library/Application Support/Brain`** | **`ripmail/`** (entire `RIPMAIL_HOME` — DB, config with secrets, OAuth files), **`cache/`**, **`var/`**, anything SQLite-heavy | Local-first; no iCloud corruption risk for DBs; **secrets stay off iCloud-synced user documents** (see below). |
| TBD | **`skills/`** | User-editable slash skills ([OPP-010](OPP-010-user-skills.md)) — likely **synced** (alongside wiki) if users expect the same commands on every Mac; could remain under App Support if treated as “bundled + local overrides.” **Decision needed.** |

**Naming / UX**

- Avoid a **single lonely subdirectory** directly under `~/Documents` with no context: prefer a **single branded root**, e.g. **`~/Documents/Brain/`** (or **`~/Brain/`** if we ever allow a top-level folder — less conventional on macOS).
- **Dot-prefixed folders** (e.g. **`~/Documents/.brain/`**) **hide in Finder by default**, which reduces clutter but also **hides the wiki from casual browsing** unless the user enables hidden files. A **visible `Brain/`** folder is friendlier for “your knowledge lives here”; **`.brain`** is better if the wiki should feel invisible next to the user’s own files. **Product call.**

---

## Perspective: what this gets right

- **Matches mental model:** wiki = durable shared brain; mail index = reconstructable cache.
- **Avoids SQLite-on-iCloud** for ripmail while still **not** requiring a custom sync engine for the wiki.
- **Aligns with Gmail / multi-account:** same OAuth/email on another device → refresh rebuilds local state; wiki already there via iCloud.

---

## Risks and gaps (important)

1. **Secrets must not ride in the synced tree.** Ripmail stores **OAuth tokens and IMAP secrets** under its home. Those should remain **`RIPMAIL_HOME` → Application Support only**. If **rules** or **config JSON** are mirrored into Documents, they must be **provably non-secret** (or split “public rules” vs “account config”).
2. **Chat history in iCloud:** JSON append-only or multi-file chat logs **sync better than SQLite**, but **two Macs chatting simultaneously** can still produce **conflict copies** (`file (1).json`) or **partially merged / invalid JSON**. Mitigations: see **[How to manage sync risk](#how-to-manage-sync-risk)** below (including **LLM repair** as a practical backstop).
3. **`wiki-edits.jsonl` / audit logs:** Today under `var/` ([`shared/brain-layout.json`](../../shared/brain-layout.json)). If audit should follow the wiki across machines, consider **synced** placement; if local-only is fine, keep in App Support.
4. **Skills:** Synced vs local affects whether slash commands match on every Mac ([OPP-010](OPP-010-user-skills.md)); default should match user expectation (likely **sync** with wiki).
5. **Non-macOS / dev:** `./data` and Linux need a clear story — e.g. **single root unchanged on non-Darwin**, or **two roots** with env vars (`BRAIN_WIKI_ROOT`, `BRAIN_LOCAL_ROOT`) everywhere for parity.
6. **Packaged app:** Tauri already sets `BRAIN_HOME`; implementation likely introduces **`BRAIN_WIKI_ROOT`** (or similar) + **`BRAIN_LOCAL_ROOT`**, with [`desktop/src/brain_paths.rs`](../../desktop/src/brain_paths.rs) and [`shared/bundle-defaults.json`](../../shared/bundle-defaults.json) updated once.
7. **Onboarding / folder picks** ([OPP-014](OPP-014-onboarding-local-folder-suggestions.md)): seeded paths should assume **wiki under Documents/Brain** (or chosen dot path) consistently.
8. **“Optimize Mac Storage”:** iCloud may **evict** rarely used files; wiki pages should stay **small and hot**; large attachments in wiki are an edge case to watch.

---

## How to manage sync risk

**Wiki (markdown):** Git-style or manual merge is possible; conflicts are visible as divergent files. iCloud conflict copies are user-resolvable; worst case, two versions of a page exist and the user or agent consolidates.

**Chat history (JSON):** Prefer formats that **fail soft** (per-session files, append-only logs) over one monolithic file every client fights over. For **inevitable mess** — duplicate conflict copies, truncated sync, invalid JSON after a bad merge — treat repair as a **recoverable** problem: **feed an LLM the broken or merged text plus a short “repair to valid schema” prompt** and expect **high-quality recovery most of the time**. This does not remove the need for sensible defaults (e.g. last-writer-wins per file, or discouraging simultaneous multi-Mac chat), but it **lowers the cost** of edge cases and avoids baking a perfect CRDT into v1.

**Operational note:** Repair should run **only when validation fails** (or on explicit “repair my chats”), with **optional** user confirmation before overwriting — privacy and cost depend on whether repair is local or remote.

---

## Implementation sketch (when picked up)

- Define **two canonical roots** in code + layout (extend or supersede single `BRAIN_HOME` with explicit segments).
- **Ripmail:** always **`RIPMAIL_HOME` = `<App Support>/Brain/ripmail`** (or keep one local root and derive).
- **Wiki:** resolve **`wiki/`** from Documents path; ensure git/remote flows ([PRODUCTIZATION.md](../PRODUCTIZATION.md)) still know the wiki disk root.
- **No backward-compat migration** per [AGENTS.md](../../AGENTS.md): document **wipe / re-seed** for devs; one-time **mover** optional for brave users.
- **Tests:** path resolution and ripmail spawn env ([`brainHome.ts`](../../src/server/lib/brainHome.ts), [`ripmailProcessEnv`](../../src/server/lib/brainHome.ts)).

---

## References

- [OPP-012](OPP-012-brain-home-data-layout.md) — current unified `BRAIN_HOME` (shipped)
- [`shared/brain-layout.json`](../../shared/brain-layout.json) — directory names
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) — configuration overview
- Ripmail: [`ripmail/src/brain_app_layout.rs`](../../ripmail/src/brain_app_layout.rs) — align layout constants when splitting roots
