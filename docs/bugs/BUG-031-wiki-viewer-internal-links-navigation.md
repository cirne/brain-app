# BUG-031: Wiki viewer — internal links unreliable / navigation still broken for many pages

**Status:** **Open.** Reporter indicates the issue is **not** resolved after multiple client-side fixes. This document records symptoms, architecture, everything attempted, assumptions that may be wrong, and a simpler long-term direction.

## Summary

In the wiki **viewer** (rendered HTML in [`Wiki.svelte`](../../src/client/components/Wiki.svelte)), clicking links that should open another vault page often **does nothing** or behaves inconsistently. Example DOM observed on a **Home** hub page:

```html
<ul>
  <li><p><a href="#">me</a></p></li>
  <li><p><a href="#">people/lewis-cirne</a></p></li>
</ul>
```

Those anchors had **`href="#"`** and **no `data-wiki`**, so the original navigation path (`closest('a[data-wiki]')` + [`resolveWikiLinkToFilePath`](../../src/client/lib/wikiPageHtml.ts)) never fired.

## How wiki HTML is produced today (relevant pieces)

| Stage | What happens |
| ----- | -------------- |
| **Server** `GET /api/wiki/:path` | [`wiki.ts`](../../src/server/routes/wiki.ts): `html = await marked(body)` — **no** [`transformWikiPageHtml`](../../src/client/lib/wikiPageHtml.ts) on the server. |
| **Client** `Wiki.openFile` / refresh | `content = transformWikiPageHtml(data.html)` then `{@html content}` inside `<article class="viewer wiki-md">`. |
| **Transform** | Rewrites Obsidian `[[wikilinks]]`, `wiki:` protocol links, relative markdown links, and (later) some `<a href="#">…</a>` patterns into `<a href="#" data-wiki="…" class="wiki-link">…</a>`. |
| **WikiFileName** | [`upgradeWikiLinks`](../../src/client/components/Wiki.svelte) mounts [`WikiFileName`](../../src/client/components/WikiFileName.svelte) **only** on `a[data-wiki]`. Anchors without `data-wiki` get no chip UI but remain plain `<a href="#">`. |
| **Click handler** | [`handleContentClick`](../../src/client/components/Wiki.svelte): resolve target wiki ref from `data-wiki`, else from non-http `href`, else from link **text** when `href` is `#` or empty; then `resolveWikiLinkToFilePath` → `openFile` → [`onNavigate`](../../src/client/components/shell/SlideOver.svelte) / shell route. |

So navigation depends on a chain: **marked output → string transforms → DOM → click logic → file list resolution**. Any gap in the transforms or in event targeting breaks the chain.

## What we tried (chronological)

1. **Runtime logging** (debug ingest): Logged `pageMode`, whether `closest('a[data-wiki]')` matched, `files.length`, and `openFile`. **Finding:** Clicks hit `<a>` but **`data-wiki` was often missing** — handler returned early before resolve.
2. **Hypothesis: only `.md` suffixed `href`s were rewritten.** Extended [`transformWikiPageHtml`](../../src/client/lib/wikiPageHtml.ts) so internal links like marked’s `[label](ideas/note.md)` / `[label](me)` (paths **without** `wiki:`) become `data-wiki` anchors.
3. **Hypothesis: `href="#"` placeholders from raw HTML** — markdown/vault can contain `<a href="#">slug</a>`; an earlier transform pass explicitly **skipped** `href="#"` when rewriting by `href`. Added a **late pass** to infer `data-wiki` from **plain text** inside those anchors (for simple, no-nested-tag markup).
4. **Click-side fallback** (same file): If `data-wiki` missing, derive target from `href` or from **link text** + [`wikiPathForReadToolArg`](../../src/client/lib/cards/contentCardShared.ts), then `resolveWikiLinkToFilePath`.
5. **Hypothesis: `event.target` is a Text node** inside `<a>…</a>` — **Text nodes have no `.closest()`**. Fixed by resolving **`start`** as `target instanceof Element ? target : target.parentElement` before `closest('a')`.
6. **User feedback:** Issue still reported as unfixed after the above — causes may include stale bundles, pages whose markup still bypasses transforms, or resolver/list mismatches not covered here.

## Assumptions that may be wrong

| Assumption | Why it may fail |
| ---------- | ---------------- |
| **All internal links appear as marked-friendly markdown** (`wiki:`, `[[ ]]`, or `(path.md)`). | Vault may embed **raw HTML** (`<a href="#">…</a>`), CMS exports, or non-standard links that never hit our regexes. |
| **After `transformWikiPageHtml`, every internal link has `data-wiki`.** | Regex passes are **order-sensitive**, attribute-order-sensitive (partially addressed), and **fragile** for nested HTML inside `<a>`. |
| **`resolveWikiLinkToFilePath` + file list is enough** | Directory labels (“People”, “Projects”) vs real paths (`people/_index.md`) need **breadcrumb/folder** semantics; slug guessing from display text is ambiguous. |
| **Click always reaches `handleContentClick` on the article** | Overlays, pointer capture, or future wrappers could steal events (not deeply validated). |
| **Svelte `{@html}` strips `data-*`** | **False** for standard Svelte — `innerHTML` keeps `data-wiki`. The gap was **string before injection**, not sanitization. |

## Complexities worth reconsidering

1. **Dual representation:** Authoring uses markdown + Obsidian conventions; runtime uses **`href="#"` + `data-wiki`** + turndown rules in the editor — **high coupling** and easy drift.
2. **Many sequential string replaces** in `transformWikiPageHtml` — hard to prove complete; edge cases multiply (`href` order, quotes, fragments, nested tags).
3. **Navigation split across three concerns:** HTML transform, click handler fallbacks, and [`WikiFileName`](../../src/client/components/WikiFileName.svelte) mounting — **three places** must agree on what a “link” is.
4. **Fake anchors:** Using `href="#"` fights the browser’s default link model (middle-click, accessibility expectations, “open in new tab” semantics unless handled).

## Fix direction: “normal links” with real `href`s (recommended simplification)

**Goal:** Internal wiki links should behave like ordinary navigation: a **real URL** the app already understands, so default `<a>` behavior and the router can align.

Concrete directions (pick one; may combine):

1. **Emit SPA URLs in markdown HTML** — When rendering wiki body HTML (server-side or in one client pass), rewrite internal targets to the **same URL shape** the assistant uses for wiki overlay (see [`parseRoute` / `routeToUrl`](../../src/client/router.ts), e.g. wiki overlay with **encoded path**). Example pattern: query or path segment the shell already parses (`wikiActive` + `overlay: { type: 'wiki', path }`). Then:

   - **Left/middle-click:** browser navigates or user uses open-in-new-tab naturally.
   - **Optional:** `click` interception only for same-document SPA transitions if full navigation is undesirable — but the **href is still meaningful** for UX and a11y.

2. **Stop relying on `data-wiki` for navigation** — Treat `data-wiki` + `WikiFileName` as **presentation only** (chips/icons), not the sole navigation key.

3. **Single pipeline** — Prefer **one** place (ideally server next to `marked`) that outputs final link `href`s for wiki pages, plus tests that snapshot HTML for representative markdown samples (`[[x]]`, `[x](wiki:y)`, `[x](path)`, raw HTML).

4. **Keep `resolveWikiLinkToFilePath` for edge cases** (slug disambiguation) but drive it from **parsed href path** instead of inferring from link text.

## Acceptance criteria (when closing)

- Clicking any internal wiki link on a representative **Home** / index page navigates to the correct page **without** depending on fragile text inference.
- Middle-click / open in new tab yields a **usable URL** (same origin + router), not `#`.
- Automated tests cover **marked output shapes** used in real vaults (including raw `<a href="#">` migration path if still supported).

## References (code)

- [`Wiki.svelte`](../../src/client/components/Wiki.svelte) — viewer, `handleContentClick`, `upgradeWikiLinks`, `{@html content}`
- [`wikiPageHtml.ts`](../../src/client/lib/wikiPageHtml.ts) — `transformWikiPageHtml`, `resolveWikiLinkToFilePath`
- [`wiki.ts`](../../src/server/routes/wiki.ts) — `marked` HTML for `GET` body
- [`router.ts`](../../src/client/router.ts) — wiki overlay routes / `routeToUrl`
