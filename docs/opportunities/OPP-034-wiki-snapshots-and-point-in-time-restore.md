# OPP-034: Wiki snapshots & point-in-time restore

## Summary

Capture **automatic, timestamped backups** of the wiki vault so users can **recover from a bad expansion, accidental edits, or agent mistakes** without a full factory reset ([OPP-032](OPP-032-brain-hub-wiki-rebuild-and-factory-reset.md)). A practical default is **ZIP archives stored under `BRAIN_HOME`** (outside the live `wiki/` tree), created on a predictable cadence—e.g. **once per completed Your Wiki supervisor lap** ([OPP-033](OPP-033-wiki-compounding-karpathy-alignment.md))—with **retention limits** and a **Hub UX** to list, inspect, and restore.

## Problem

- The wiki is **small, mostly text**, and **high leverage**: corruption or over-eager agent edits are painful.
- **Rebuild wiki** (OPP-032) is **nuclear**—users may want “go back to yesterday” instead of “start over.”
- **No product surface today** for “what did my wiki look like before that lap?”
- Manual recovery (Finder, Time Machine) is **possible but undocumented** and **not aligned** with split layout ([OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md)) mental models.

## Goals

- **Automatic snapshots** on a clear trigger (default: **end of each supervisor lap**, or configurable interval).
- **Simple restore**: user picks a snapshot → confirms → **replaces live wiki tree** with archive contents (no git branches, no merge UI).
- **Inspectable backups**: user can **compare or browse** candidates before restoring.
- **Cross-platform friendly**: implementation should work on **macOS now** and **Windows later** without relying on OS-specific snapshot APIs.

## Non-goals

- Full **version control** UX (history per file, blame, branches).
- **Continuous** replication or cloud backup (could be a follow-on; zips in `BRAIN_HOME` remain copyable by the user).
- Backing up **entire** `BRAIN_HOME` (chats, ripmail) in v1—scope is **wiki vault only** unless we explicitly expand later.

## UX (discovery → inspect → restore)

**Placement:** Brain Hub **Data & recovery** (alongside [OPP-032](OPP-032-brain-hub-wiki-rebuild-and-factory-reset.md)): section **“Wiki snapshots”** or **“Previous versions.”**

### List

- Rows sorted **newest first**: **timestamp** (local + optional UTC), **size**, **file count** (or “~N files” from manifest), optional **trigger** (“After lap 47 — cleanup”).
- **Retention copy:** “Keeping the last **K** snapshots” or “**~X MB** max” so expectations are clear.

### Inspect (before restore)

Users need confidence they’re picking the **right** moment:

- **Preview:** App extracts the ZIP to a **temp directory** (or streams a manifest generated at snapshot time) and offers:
  - **Tree summary** (top-level folders, recent paths), or
  - **Read-only browse** of a few key files (`me.md`, index pages) without mutating the live wiki.
- **Open in Finder / Explorer:** Reveal the `.zip` so power users can double-click or diff with external tools.
- Optional **lightweight diff** (later): “Files changed vs current wiki” using a manifest of paths + hashes captured at snapshot time—**not required for v1**.

### Restore

- **Strong confirmation:** short explanation that the **current wiki will be replaced**; recommend taking **one manual export** or rely on **auto pre-restore snapshot** (see below).
- **Safety valve:** Immediately before replace, write **one** “pre-restore” ZIP of the **current** broken tree (or move it aside) so the user can **undo a mistaken restore** without digging in Finder.
- **Operational:** Pause or **drain** wiki-writing agents during replace; **resume** after filesystem is consistent.
- **Post-restore:** Toast + link to wiki home; optional “re-run expansion” nudge if index looks empty (tie to OPP-032 flows, not automatic).

## Technical approaches

### A — Timestamped ZIP under `BRAIN_HOME` (recommended baseline)

**Layout (illustrative):** `$BRAIN_HOME/var/wiki-snapshots/wiki-20260420T153022Z-lap47.zip` or a dedicated `backups/wiki/` segment added to [brain-layout](OPP-012-brain-home-data-layout.md) if we want it first-class.

**Contents:** The **`wiki/`** directory as it exists on disk for the active vault root ([OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md) — zip **`BRAIN_WIKI_ROOT/wiki`**, not `BRAIN_HOME/wiki` when split).

**Pros**

- **Portable**, **inspectable** with any OS zip tool; **compresses well** for markdown-heavy trees.
- **Windows-ready:** Node can create/read ZIP without native snapshot APIs.
- **Simple mental model:** one file = one point in time.

**Cons / mitigations**

- **Consistency:** snapshot while writers are active risks torn state. **Mitigation:** snapshot **after** a lap boundary when the supervisor is idle; optionally take a **two-phase** copy (copy tree to temp, then zip) or use OS `rsync`/recursive copy then zip.
- **iCloud / sync:** wiki may be on a synced volume; zips in `BRAIN_HOME` stay **local**—good default ([OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md) cautions on syncing SQLite, not markdown vault read-mostly).
- **Very large wikis:** set **max count + max total bytes**; drop oldest.

### B — Local git repository (optional / advanced)

Initialize a **bare or non-bare** repo beside or under the vault, commit **only** on snapshot triggers.

**Pros:** Efficient deltas; familiar to developers; possible future “diff to commit.”

**Cons:** **`.git` may already exist** in user wiki; **merge/rebase** semantics leak into support; **Windows** path + line-ending friction; **harder** for non-technical “pick a zip and restore” story. Better as a **power-user** or **export** path than the primary backup mechanism.

**Verdict:** Prefer **ZIP for product UX**; git could be **documentation** (“you may also use your own git remote”) rather than built-in v1.

### C — Filesystem snapshots (Time Machine, VSS)

**Pros:** Zero app code; captures everything on volume.

**Cons:** **Not app-controlled**, **not discoverable** in Hub, **platform-specific**, restore granularity is **volume-level** or awkward. Treat as **complement**, not the Brain-native solution.

## Trigger & retention

| Knob | Suggested default |
|------|-------------------|
| **When** | End of each **Your Wiki** supervisor lap (success path); skip if wiki unchanged (optional hash of tree manifest) |
| **Retention** | Last **15–30** snapshots **or** ~**500 MB–1 GB** total, whichever bound hits first (tunable) |
| **Manual** | Hub button **“Snapshot wiki now”** |

**Sidecar metadata (optional JSON next to zip):** `lap`, `phase`, `wikiRoot`, `fileCount`, `bytes`, `contentHash` for UI and for “skip if unchanged.”

## Implementation sketch

- **Server module:** `createWikiSnapshot(reason)`, `listWikiSnapshots()`, `restoreWikiSnapshot(id)`, `extractWikiSnapshotPreview(id) → tempPath` with tests mirroring [dev route](OPP-032-brain-hub-wiki-rebuild-and-factory-reset.md) patterns.
- **Atomic restore:** extract to **temp**, **rename swap** into place (platform-specific care on Windows: extract then move tree), or delete+replace in one transaction where the FS allows.
- **Permissions:** Same **local-only** stance as destructive Hub actions; no remote API.

## Relationship to other OPPs

- [OPP-032](OPP-032-brain-hub-wiki-rebuild-and-factory-reset.md): snapshots are **before** rebuild/reset; restore is **lighter** than full rebuild.
- [OPP-024](OPP-024-split-brain-data-synced-wiki-local-ripmail.md): snapshot source path must follow **wiki root** resolution (`brainWikiParentRoot()` / `wikiDir`).
- [OPP-033](OPP-033-wiki-compounding-karpathy-alignment.md): **lap completion** is the natural hook for automatic snapshots.
- [OPP-012](OPP-012-brain-home-data-layout.md): store archives under a **`BRAIN_HOME`** segment; do **not** place giant zip trees **inside** the synced wiki folder unless the user opts in.

## Status

**Proposed** — UX + technical options; no implementation yet.
