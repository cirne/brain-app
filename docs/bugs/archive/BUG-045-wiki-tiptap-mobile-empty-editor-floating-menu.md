# BUG-045: Wiki TipTap — empty document on iOS Simulator / WebKit; FloatingMenu regression trail

**Status:** Fixed (user confirmed). Instrumentation and NDJSON ingest hooks **removed** from the tree.

## Historical summary

On **WebKit / iOS Simulator**, the wiki chrome could show the correct file path while **TipTap displayed only the placeholder**. **FloatingMenu (“+ blocks”)** also misbehaved on mobile (stuck or over text).

## Resolution (shipped in app code)

Combined client fixes:

- **`floatingBlockMenuShouldShow`** — align with TipTap’s top-level empty block rule (`$anchor.depth === 1`) so nested list empties do not keep the menu always eligible.
- **No per-`transaction` `hideStaleBrainFloatingBlockMenu`** — avoided WebKit / ProseMirror interaction from extra dispatches; **Escape** still dismisses via **`tryDismissTipTapFloatingMenuFromEscape`**.
- **Markdown sync** — **`TipTapMarkdownEditor`** `$effect` reapplies markdown when **`initialMarkdown`** or **`markdownSyncEpoch`** changes (no stale **`lastImported`** short-circuit stranding content).
- **`Wiki.svelte`** — **`setWikiRawMarkdown`** bumps **`wikiMarkdownSyncEpoch`** on server load / clear; **`persist`** updates **`rawMarkdown`** without bumping epoch to avoid caret reset on save.
- **`floatingBlockMenuShouldShow`** **import** restored in **`TipTapMarkdownEditor.svelte`** where **`FloatingMenu.configure`** uses it.

Debug **`fetch` → `127.0.0.1:7345`** from Simulator **never** reached the Mac; stray server ingest blocks were removed from **`onboarding.ts`** / **`ripmailHeavySpawn.ts`**.

## Prior investigation notes

See git history for the full “what we tried” table that lived in the active BUG file before archive.
