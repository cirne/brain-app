# Archived: OPP-059 — Wiki home jump + `/wiki`

**Archived 2026-04-30.** **Status: Implemented (Phase 1–2).** Top nav wiki control (`AppTopNav.svelte`); **`/wiki`** + `wikiActive` in [`router.ts`](../../../src/client/router.ts). Composer handoff (Phase 3) may be future. **Stable URL:** [stub](./OPP-059-wiki-home-jump-and-route.md).

---

# OPP-059: Wiki home jump — prominent entry + first-class `/wiki` route

**Tags:** `navigation` · `wiki` · `routing` · `ux` · `shell` · `search`  
**Related:** [OPP-058](./OPP-058-spa-url-main-pane-vs-overlay-query.md) (chat `/c`, Hub `/hub`, overlays `?panel=`); [`src/client/router.ts`](../../../src/client/router.ts); [OPP-021](../OPP-021-user-settings-page.md) (Brain Hub); [archive/OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md) (full-width wiki surface — deprioritized); [runtime-and-routes.md](../../architecture/runtime-and-routes.md); [`AppTopNav.svelte`](../../../src/client/components/AppTopNav.svelte); [`ChatHistory.svelte`](../../../src/client/components/ChatHistory.svelte)

---

## One-line summary

Stop burying **wiki home** (`index.md` / vault root) under **Brain Hub**. Add a **prominent, always-visible jump** to open it — **primarily in the top nav** (icon or equivalent action); **optionally** a second prominent affordance in the **left rail** (single control, not a mode switch). **Do not** add rail segments, **do not** put hierarchical wiki navigation in the sidebar — **browse stays on the wiki page** (links from home into the tree).

---

## Mental model

- **Chat** stays the default workspace; **⌘K** stays the omnijump (wiki, mail, future corpus).
- **Wiki home** is a **destination**, not a sidebar product: users land on the **home page** and navigate from there inside the main pane (existing wiki rendering).
- **Explicit rejections for this OPP:** **no** **Chats  Documents** (or any) **segmented rail**; **no** **wiki folder tree** or hierarchical outline **in the left rail**.

---

## Problem

- **Wiki index / home** is easy to miss — often reached only via **Hub** ([OPP-021](../OPP-021-user-settings-page.md)), i.e. mixed with settings.
- **Recents** in the rail lists touched docs but does not substitute for **“take me to wiki root now.”**
- Today, wiki views are commonly `**?panel=wiki&path=…`** on `**/c/…`** ([OPP-058](./OPP-058-spa-url-main-pane-vs-overlay-query.md)), which ties reading to chat in the URL story; a `**/wiki`** primary pane (Phase 2) improves bookmarking **wiki home** without implying hierarchy in chrome.

---

## Entry points (target)

1. **Top nav — primary** — One clear control (e.g. **book / wiki icon** next to search / new chat / Hub cluster) that navigates to **wiki vault root** → opens `**index.md`** (or agreed default) in the main/detail pane. Same action surface area whether packaged app or browser.
2. **Left rail — optional secondary** — One **prominent** row or button (e.g. below **New chat**, or a compact strip): **“Wiki home”** / **“My wiki”** → same navigation as top nav. Still **no** tree, **no** second rail “mode.”
3. **⌘K** — Unchanged; continues to jump to arbitrary wiki paths and mail.
4. **Hub** — Remove **duplicate nav-only** “wiki index” escape hatches once the above ships; Hub keeps **account, connectors, maintenance**, not “how do I open wiki home.”

---

## Proposed direction (phased)

### Phase 1 — Prominent wiki-home jump (ship first)

- Implement **top-nav** affordance + wire it to open wiki home in the existing wiki reader (same overlay/main behavior as today when opening `index.md`).
- Optionally add **left-rail** duplicate (same destination).
- **Hub cleanup:** demote/remove redundant **navigation-only** wiki index rows.

**Success:** From any screen, **one obvious click** (and ideally **⌘⇧H** if adopted — see keyboard section) reaches wiki home **without** opening `/hub` for navigation.

### Phase 2 — Router: `/wiki` primary surface (medium)

- Extend `parseRoute` / `routeToUrl` ([`router.ts`](../../../src/client/router.ts)) with `**wikiActive`** for `**/wiki`** (+ optional path) — [OPP-058](./OPP-058-spa-url-main-pane-vs-overlay-query.md) “pathname = primary pane.”
- Main pane: wiki reader **without** requiring `**/c/{session}`** for read-only entry when landing from wiki-first URLs.
- Deep links reload-stable; encoding TBD (`?path=` vs segments).

**Success:** Bookmark **wiki home** without chat id in path.

### Phase 3 — Composer handoff (optional / guarded)

- On `**/wiki…`**, first composer send creates chat + navigates to `**/c/…?panel=wiki&path=…`** (or agreed shape) with doc context.

**Scope guard:** Ship Phase 1–2 if Phase 3 balloons.

---

## Non-goals

- **Segmented left rail** (two modes, “Chats vs Documents,” or any variant).
- **Hierarchical wiki navigation** (folder tree, outline) **in the left rail** — hierarchy belongs **in the wiki page content** and main-pane wiki UI.
- A **dedicated Mail/Inbox rail segment** (unchanged product stance: mail via search, recents, overlays).
- Replacing Hub’s **Your Wiki** supervisor / maintenance — only removing **nav duplication**.
- Reopening [archive/OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md) full-width wiki activity surface unless product explicitly resurrects it.
- Ripmail or vault **on-disk** layout changes.

---

## Validation criteria

- `**router.test.ts`:** when Phase 2 lands, round-trip `**/wiki`**; coexistence with `**/c`** + `**?panel=wiki**` tested.
- **Component tests:** top-nav (and optional rail) invoke same navigation target as opening wiki home today.
- **Smoke:** wiki home reachable **without** Hub-as-navigation; search unchanged.

---

## Open questions

1. **Icon vs text** in top nav (book icon-only vs “Wiki” label); tooltip and a11y name.
2. **Exact `/wiki`** encoding (segments vs `path=`).
3. **Left rail:** ship **top nav only** first vs both in one PR.
4. **Search palette:** optional command **“Wiki home”** mirroring the button.

---

## Keyboard shortcuts (proposal — companion to ⌘K / ⌘N)

**Today** ([`globalShortcuts.ts`](../../../src/client/lib/app/globalShortcuts.ts)): **⌘K** search, **⌘N** new chat, **⌘R** refresh.


| Intent                               | Proposed chord         | Rationale                                                              |
| ------------------------------------ | ---------------------- | ---------------------------------------------------------------------- |
| **Search**                           | **⌘K**                 | Keep.                                                                  |
| **New chat**                         | **⌘N**                 | Keep in app; **⌘⇧C** browser fallback for new chat if ⌘N is swallowed. |
| **Wiki home** (same as top-nav jump) | **⌘⇧H** / Ctrl+Shift+H | **H** = home; avoids **⌘W**, bare **⌘G** (Find next).                  |


**Implementation:** capture-phase listener; `**preventDefault`** when handling; extend `**matchGlobalShortcut`** + tests when shipping.

---

## Relation to archived OPP-027

[OPP-027](./OPP-027-wiki-nav-indicator-and-activity-surface.md) proposed a **large wiki activity surface** and indicator-centric IA. **OPP-059** is narrower: **prominent wiki-home entry** + optional `**/wiki`** route — **no** rail reshape and **no** sidebar hierarchy.