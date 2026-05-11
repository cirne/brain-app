# Archived: OPP-092 — Mobile IA

**Status: Archived (2026-05-11).** Mobile shell redesign epic closed for tracking.

**Stub:** [../OPP-092-mobile-navigation-ia-rethink.md](../OPP-092-mobile-navigation-ia-rethink.md)

---

## Original spec (historical)

### OPP-092: Mobile navigation IA rethink (top chrome + L2 header + WYSIWYG)

**Status:** Proposed — IA + UX redesign of the mobile shell, with a smaller follow-on for desktop polish.
**Related:** [BUG-041](../bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md) (archived symptom screenshots), [archived OPP-049](archive/OPP-049-global-ui-tailwind-refactor.md) (Tailwind base), [OPP-058](OPP-058-spa-url-main-pane-vs-overlay-query.md) (URL routing of overlays), [OPP-055](OPP-055-tap-to-talk-mobile-panel-ux.md) (mobile panel chrome conventions). **Specifically supersedes the resolution proposed in BUG-041** — the bug becomes a tracking pointer once this OPP lands.

---

## Why this exists

The mobile shell of Braintunnel today is a **desktop-first nav squeezed onto a phone**. We currently render, on a single iOS WebKit screen with a chat *and* an open wiki overlay (see [BUG-041 screenshots](../bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md)):

**L1 — `AppTopNav` (`src/client/components/AppTopNav.svelte`)** — 5 controls + a brand/menu chip + the Hub widget:

1. Brand / `BrainCircuit` (toggles sidebar)
2. `Search` (⌘K)
3. `BookOpen` (Wiki home)
4. `MessageSquarePlus` (New chat)
5. `Settings`
6. `BrainHubWidget` (Hub icon + sync error badge + page-count meter)

**L2 — `AgentChat` `PaneL2Header`** — chat title + currently-selected wiki context chip + `ConversationTokenMeter` + `Volume2`/`VolumeX` (sound) + `Trash2` (delete chat). Five things in the second-level bar already, before the overlay opens.

**L2′ — `SlideOver` `PaneL2Header` (when a doc is open)** — `ChevronLeft` back + a wrapped multi-line breadcrumb (`My Wiki / Travel /` + `Boys Trip 2026.md`) + `Share2` + `Pencil` (edit toggle). Breadcrumb wraps to a second line because the back button + share/edit consume the title row.

In total a doc-open mobile screen surfaces **~13 distinct controls** above the reading content — most are persistent, none are grouped, and several are duplicated (e.g. chat title and wiki title both visible while only one surface is interactive).

Concrete failure modes that come out of this:

- **Mobile is desktop-with-icons, not mobile-first.** Spacing was tuned for ≥768px; on a phone we just shrink labels off and keep every icon.
- **Back goes too far.** `headerDismiss()` always closes the slide-over back to chat. Tapping a wiki link inside a wiki page pushes a new page but `Back` exits to chat, losing the prior page.
- **Breadcrumb wraps and pushes the title down.** `wiki-dir-breadcrumb` uses `flex-wrap` so on a phone the path lands above the filename, eating a row.
- **Edit is a modal toggle.** The pencil flips `pageMode` between `view` and `edit`; switching loses scroll position and feels like a dialog. The user’s direction is **always-on WYSIWYG** for a single-user app.
- **Action surfaces collide.** Sound + delete + token meter sit in the chat header *while* a doc is foregrounded. The user is reading the doc; chat-scoped controls should not be live in that moment.
- **No “overflow.”** Today there is no shared “⋯ more” pattern, so every action competes for the top bar.

[BUG-041](../bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md) called for an IA + responsive pass. This OPP is that pass.

---

## Primary use cases (mobile)

From observing usage and the user’s direction, the things that have to be fast on a phone:

**Always-available (any surface):**

1. **Search** — across mail + wiki + chats.
2. **Browse the wiki** — jump to wiki home / a recent doc.
3. **Start a new chat** — capture an idea without context-switching.
4. **Open settings** — hub, accounts, mailboxes, sharing, sign-out.

**Context-scoped (only when relevant):**

1. **In a chat:** toggle "Hear replies" (TTS), delete the chat. Token meter is useful but not primary.
2. **In a wiki doc:** share the page, edit it (live, no toggle), navigate the folder it lives in.
3. **In an email thread:** reply, forward, archive (already shipped via `INBOX_THREAD_HEADER`).
4. **In a draft:** save, send (already shipped via `EMAIL_DRAFT_HEADER`).

**Navigation-state primitives:**

1. **Back one level** — pop the last navigation, do not jump to the chat root.
2. **Close the doc/email/calendar overlay** — return to chat (an explicit, separate action).

The user explicitly called out: *“we should be moving towards WYSIWYG editing so that there is no toggle.”* That collapses #6 from two states (`view` ⇄ `edit`) into one always-editable surface — see [§ WYSIWYG track](#wysiwyg-track) below.

---

## Three options

Each option keeps the existing `Overlay` router contract and tenant routes. They differ in **where chrome lives** and **how overflow is handled**.

### Option A — “Single bar + ⋯ overflow sheet” (mobile-first minimum)

A 48px top bar with **at most three slots**: leading nav, title (current surface), trailing single overflow.

```
[ ☰ / ◀ ]   Boys Trip 2026                     [ ⋯ ]
```

- Leading slot is `☰` at the chat root (opens the existing history drawer) and `◀` everywhere else (pops one nav step; closes overlay only when stack depth = 1).
- Title is always the **current surface** — chat title at the chat root, doc title when reading a doc, thread subject when reading mail. No duplicated chat title above a doc title.
- The breadcrumb collapses to an inline secondary line **only on doc surfaces**, single-line, horizontally scrollable — never wraps.
- Trailing slot is one `⋯` button that opens a **bottom sheet**. The sheet contents are contextual:
  - **Chat root:** New chat, Search, Wiki home, Settings, Hub status, Sign out.
  - **In a chat:** Hear replies (toggle), Delete chat, Token meter (read-only row), New chat, Search.
  - **On a doc:** Share, Open folder, Copy link, Search, "Open chat about this page" (pin chat to doc context).
  - **On a thread / draft:** the inline Reply/Forward/Archive (or Save/Send) row remains visible because they are primary; the sheet adds the rest.
- L2 chat header on mobile **is removed entirely** while an overlay is foregrounded. The chat is still mounted for the slide animation, but its header is hidden by a `mobile-overlay-foregrounded` boolean — no double titles.
- Live WYSIWYG eliminates the pencil/save toggle on the doc surface (see [§ WYSIWYG track](#wysiwyg-track)).

**Pros:** lightest cognitive load; matches iOS Mail / Notes patterns; one consistent overflow pattern; minimal new components.

**Cons:** a bottom sheet is a new component (today only `ConfirmDialog` and `WikiShareDialog` exist as modals); discoverability of context-aware sheet contents takes a session to learn.

### Option B — “Top bar + bottom tab bar”

Move primary navigation to a thumb-reachable tab bar at the bottom of the viewport.

```
[ ☰ ]   Boys Trip 2026                          [ ⋯ ]

… content …

[ Chat ] [ Wiki ] [ Inbox ] [ Search ] [ Hub ]
```

- Top bar is even lighter than Option A: `☰`/`◀`, title, contextual single action (Edit-as-state, Share, or `⋯`).
- Bottom tab bar handles 4–5 globals: Chat, Wiki, Inbox, Search, Hub/Settings.
- Per-surface actions still come from a `⋯` overflow on the top right.
- `New chat` becomes a `+` floating action on the Chat tab when it has any messages, mirroring iOS Messages.

**Pros:** every primary nav is one tap from anywhere; more thumb-friendly than top-row icons; works well on tall phones; matches Apple/Google native conventions.

**Cons:** competes with the iOS Safari address bar for bottom space (notably in Chrome on iOS, where the URL bar persists at the bottom — see screenshots). Bottom tabs would land *above* the URL bar but with very little breathing room. Also adds vertical chrome on small devices.

### Option C — “Drawer-everything: 2-control top bar”

Push almost everything into the existing left drawer, including search and global actions.

```
[ ☰ ]   Boys Trip 2026                          (no buttons; sync dot only)
```

- Drawer top region becomes a **search input** (not just a button), recent-docs row, recent-chats row, quick actions (New chat, Wiki home, Inbox, Settings, Hub), and a Sign out / mailbox account row.
- Doc/chat-specific controls live in a **small context bar pinned above the composer** on the chat surface (e.g. `Hear replies` + `Delete chat` chips when a chat has messages), and via a `⋯` menu next to the title on overlay surfaces.
- Pure depth-aware back: `ChevronLeft` replaces hamburger when nav stack > 1.

**Pros:** the cleanest reading surface — one ☰ + a title is all the chrome above content. Fits a true "content-first" aesthetic.

**Cons:** every primary action becomes a 2-tap flow (open drawer → tap action); search in particular becomes harder than today; relies heavily on drawer discoverability; "not knowing what's there" is a real new-user cost.

---

## Recommendation

**Adopt Option A as the mobile baseline, with one piece of Option B borrowed for new-chat:** keep the `+` (New chat) as a small persistent button next to the title on the chat root, because that one action is high-frequency and the user explicitly named it as primary.

Why Option A:

- Matches the platform vocabulary the user already lives in (iOS Mail/Notes/Files).
- Reuses our existing `SlideOver` + `PaneL2Header` machinery; we are not introducing a tab bar that would fight the iOS Chrome URL bar (visible in [BUG-041 screenshots](../bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md)).
- The bottom sheet is a small, reusable component — useful elsewhere (e.g. message thread overflow, calendar event details on phone).
- It composes cleanly with the always-on WYSIWYG direction: the doc surface goes from "title + back + breadcrumb + share + edit toggle + save indicator" to "title + back + ⋯". Share and Save state move into the sheet (or live as transient toasts).
- It does *not* preclude Option B later — a bottom tab bar can be added on top of an Option A baseline if mobile usage shows the drawer is too slow for primary nav.

---

## Desktop direction (smaller pass)

Desktop is OK today; the user’s frustration is mobile-specific. The follow-on desktop tweaks that fall out of this work:

- **Drop the doc edit toggle on desktop too** once WYSIWYG ships. The `Pencil`/`Save` button row in the slide-over goes away; saved-state stays as the small inline `Saving… / Saved` text already present.
- **Keep `AppTopNav` labeled** on `≥md` (Search · Wiki · Chat · Settings) — it’s a fine desktop bar.
- **Move the chat token meter into a small popover from a single icon** at the chat header right edge (clicking shows the full `ConversationTokenMeter` panel), so the chat L2 header is icon + title + `⋯`.
- **Breadcrumb on desktop** stays single-line in the L2 header; only on mobile does it move to the secondary line.

---

## WYSIWYG track {#wysiwyg-track}

Always-on WYSIWYG editing for wiki docs is a **prerequisite simplifier** for the mobile redesign. With it:

- The `Pencil` / `Save` toggle in `SlideOver.svelte` is removed.
- `Wiki.svelte` no longer maintains `pageMode = 'view' | 'edit'` and no longer flushes/re-renders on toggle.
- `TipTapMarkdownEditor` becomes the *only* renderer for own-vault `.md` pages; rendered HTML is only used for shared (read-only) wikis.
- `saveState` becomes a transient inline status indicator near the title, or a brief toast.

What needs validating before this lands:

1. **Cursor + scroll preservation** under the streaming-write path (`streamingWrite` and `streamingEdit` from agent tools must not stomp the user’s caret while they’re typing).
2. **Wiki link rendering parity** — `upgradeWikiLinks` currently rewrites anchors in rendered HTML. The TipTap path needs the same `WikiFileName` mounting, ideally via a TipTap node-view.
3. **Read-only modes** — shared wikis (`sharedMode`) and streaming-busy must remain read-only without a state flip the user can see.

This track ships on its own branch; the mobile-shell work depends on it for the “no edit toggle” UX but can land the L1/L2 simplification first against the existing toggle.

---

## Implementation outline

A rough order of operations once the recommendation is accepted:

1. **Define a `MobileSurfaceShell` component** (one bar + optional secondary breadcrumb line + content slot) and wire it as the L2 header for mobile only. Desktop keeps the current `PaneL2Header` slots.
2. **Build a `BottomSheet` primitive** (full-width, 60% height, swipe-to-dismiss, focus-trap) — a small Svelte component that other places will reuse.
3. **Centralize navigation context.** Today, the slide-over knows what surface it’s showing but doesn’t know "how many nav steps deep" the user is. Add a small per-overlay nav stack (in `router.ts` or an `overlayStack` store) so back can pop one step before closing.
4. **Refactor `AppTopNav`** for mobile: collapse Wiki / Chat / Settings into the `⋯` sheet on `<md`. Keep the labeled row on `≥md`. The hamburger / brand chip on the left stays.
5. **Refactor `SlideOver` `PaneL2Header`**: title-only on mobile, share + edit + page actions move into the sheet; Cancel/Reply/Forward/Archive stay inline because they are the primary action of the surface.
6. **Hide the chat L2 header when an overlay is foregrounded on mobile** — add a `chatHeaderHidden` flag driven by `mobilePanel && overlay.type !== 'none'`.
7. **Single-line breadcrumb with horizontal scroll** for the wiki path on mobile; replace `flex-wrap` with `overflow-x-auto whitespace-nowrap`.
8. **Land the WYSIWYG track** and remove the edit toggle from `SlideOver`.
9. **Desktop polish**: token meter popover; remove edit toggle once WYSIWYG is on.

Each of these is independently shippable; the IA win is roughly steps 4–6 even before the bottom sheet primitive exists (an interim implementation can route `⋯` to a `<dialog>` or reuse `ConfirmDialog`’s overlay layer).

---

## Acceptance criteria

- On a 390×844 viewport (iPhone 14), the chat root shows **at most three top-bar controls** plus the brand chip and Hub widget. Recommended layout: `☰ · title · + · ⋯`.
- On a wiki doc on the same viewport, the top bar shows `◀ · title · ⋯`. The breadcrumb is one line, single-row, horizontally scrollable, and never pushes the title down.
- Tapping `◀` from a wiki page that was reached via a wiki link inside another wiki page **returns to the previous wiki page**, not to the chat root. Tapping `◀` again returns to chat.
- The chat L2 header (sound, delete, token meter) is **not visible** on mobile while a doc/email/calendar overlay is foregrounded.
- Sound, delete, and token-meter readout for the active chat are reachable from the `⋯` sheet on the chat surface in two taps.
- Wiki edit no longer has a mode toggle (post WYSIWYG track); the doc surface shows the editor immediately and `Save` state is a non-blocking inline indicator.
- Desktop chrome is unchanged in feel, with the small wins listed in [§ Desktop direction](#desktop-direction-smaller-pass).

---

## Out of scope

- **Full theming / DESIGN.md adoption** — see [OPP-089](OPP-089-google-design-md-exploratory.md). This OPP ships with the existing Tailwind tokens.
- **iOS-style URL-bar shroud / standalone install** — separate work; not required for this redesign.
- **Sharing UX** — `WikiShareDialog` stays as today; this OPP only changes how the entry point is presented (top bar icon vs sheet item).
- **Calendar header redesign** — the existing week-nav inline header is fine on mobile; only the host bar around it changes.

---

## Open questions

1. **Where does the Hub widget live on mobile in Option A?** Likely in the `⋯` sheet for the chat root, with a small dot on `⋯` itself when there are sync errors. Worth a check that the user still feels the Hub is "always available."
2. **Should `+` (New chat) ever appear from inside an overlay?** Probably no — keep the trailing slot single-purpose per surface; new-chat lives in the chat root and inside the drawer.
3. **Does Search become a route or stay a modal?** `OPP-058` already gave us routable overlays; promoting search to `?panel=search` would let it deep-link and back-button cleanly. Worth doing as part of this work.
4. **Drag-to-go-back parity.** The slide-over already supports edge swipe to dismiss (`mobile.swipeState`). Confirm it stays one-level pop, not all-the-way close, after we add the multi-step nav stack.
5. **Token meter in the sheet** — read-only row vs its own modal. The current `ConversationTokenMeter` is small; a row line with `4.2k / 200k` is probably enough.

---

## References

- `src/client/components/AppTopNav.svelte` — current L1.
- `src/client/components/PaneL2Header.svelte` — slot recipe used by chat + slide-over.
- `src/client/components/AgentChat.svelte` — chat L2 header (sound, delete, token meter).
- `src/client/components/shell/SlideOver.svelte` — overlay L2 header, breadcrumbs, share/edit, fullscreen, draft Save/Send.
- `src/client/components/Wiki.svelte` — `pageMode` toggle, `setPageMode`, `streamingWrite`/`streamingEdit` plumbing that the WYSIWYG track needs to keep working.
- `src/client/lib/slideOverHeader.ts`, `src/client/lib/wikiSlideHeaderContext.ts`, `src/client/lib/inboxSlideHeaderContext.ts`, `src/client/lib/emailDraftSlideHeaderContext.ts` — per-surface header registration; the new mobile shell can keep this contract.
- [BUG-041](../bugs/archive/BUG-041-doc-viewer-chrome-mobile-nav-too-many-controls.md) — symptom screenshots and "what should be expected" framing.

