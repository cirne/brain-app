---
name: files
label: "Files: add or update the folders Brain reads from your computer"
description: >-
  Manage which folders on your computer Brain has indexed — add a new folder ("use everything in
  ~/Documents"), remove one, change labels or paths, or re-read a folder after you've added new files.
  Sane defaults: common document types (PDFs, Word, Markdown, plain text, spreadsheets) are included;
  build folders, node_modules, .git, and very large files are skipped. Examples: "add my Documents
  folder"; "also index ~/Reading"; "stop indexing my dev folder"; "I added new contracts — refresh
  that folder." Custom file-type filters (e.g. PDFs only) may need a future update — add the folder
  with defaults first and say so if the user asks for strict filtering.
hint: which folder to add, change, or stop indexing — say it plainly
args: >-
  Optional natural language: folder path, friendly name, or "refresh everything." No required
  structured parameters.
---

# Files (indexed folders)

This skill is for **managing** which folders on your computer are part of Brain’s search — not for day-to-day searching (use normal chat for that).

## Access and discovery (macOS)

The app is set up with **Full Disk Access** at launch so Brain can read the user’s files when they want help. **Do not ask for permission** before listing directories, walking folder trees, or reading file names when you’re helping someone find or choose what to index — that’s normal exploration, not a privacy prompt. Use wiki `find` / `grep` / `read` (and `search_index` when content is already indexed) to browse and narrow down: e.g. “show me folders that might hold legal docs,” then propose a concrete path to add.

Reserve **explicit confirmation** for **destructive or irreversible** steps: removing an indexed source (`remove_files_source`), sending email, or deleting files — not for “looking around” the disk.

## When to use

- The user wants to **add**, **remove**, **rename**, **move**, or **re-index** a folder Brain should read from.
- **Not** for: "find my contract" or "what did that PDF say?" — use normal chat to search and read.

## Defaults (plain English)

By default, Brain indexes common **documents and text** under the folder you choose: PDFs, Word files, Markdown, plain text, HTML, spreadsheets, and similar. It **skips** things that are usually noise or huge: **photos, video, audio**, dependency folders like **`node_modules`**, **`.git`**, typical **build output**, and files **over about 10 MB** (they’re skipped with a log line, not silently corrupted).

If the user asks for **only PDFs** or **exclude pictures** and the tools don’t yet support custom include/ignore lists, **say that honestly**: add the folder with defaults now, or point them to a future tighter filter — don’t pretend you applied rules you didn’t.

## Process

1. **Discover (optional)** — If the user hasn’t given a path, explore: list directories and filenames under sensible roots (`~/Documents`, project folders they named) until you can suggest **one** folder to add. No permission prompt for browsing.
2. **Clarify** — If the path is still ambiguous after exploration, ask once for the exact folder (e.g. `~/Documents/Legal`).
3. **Add** — `add_files_source` with `path` and optional `label`, then `reindex_files_source` for that source (or omit `source_id` to refresh everything).
4. **Status** — Use `list_sources` / `source_status` so the user sees what’s configured and approximate counts.
5. **Remove** — **Confirm** before `remove_files_source` (it removes the source from config and drops its index rows).

## Quality bar

- Never hide errors: if a path doesn’t exist or ripmail fails, say what happened.
- After add or re-index, give a short recap (source id, path, that a background refresh started if applicable).
- Don’t turn this into a filesystem tutorial — stay at the level a busy professional expects.
