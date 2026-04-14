# Chat-first UX (concept)

This document surveys the **current** brain-app shell and outlines a possible **chat-first** direction: one primary surface (rich conversation), with detail views sliding in as needed—similar to how a simple search box can progressively surface structured “answer” content.

---

## Current UI model (as of this repo)

### Tabbed main surface

The app uses **URL-backed tabs** for four full-page surfaces (`src/client/router.ts`):


| Tab          | Route                  | Main component                                                                            |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------- |
| **Today**    | `/`                    | `Home.svelte` — date heading, today’s calendar (`DayEvents`), inbox summary, wiki recents |
| **Inbox**    | `/inbox`, `/inbox/:id` | `Inbox.svelte` — list + thread                                                            |
| **Wiki**     | `/wiki`, `/wiki/...`   | `Wiki.svelte` — tree + markdown viewer                                                    |
| **Calendar** | `/calendar`, `?date=`  | `Calendar.svelte`                                                                         |


The **top nav** (`AppTopNav.svelte`) exposes these as explicit tab buttons, plus global affordances: **search** (⌘K), **sync** (⌘R), optional **dirty/recent wiki files** dropdown.

**Keyboard:** digits ⌘/⌃/⌥⌘ **1–4** switch tabs in a fixed order (`globalShortcuts.ts` matches `TAB_ORDER`: today, inbox, wiki, calendar).

### Persistent agent column (“drawer”)

The **agent/chat** is not a tab. It lives in a **persistent right-hand column** (`AppAgentColumn.svelte` → `AgentDrawer.svelte`):

- **Desktop:** fixed width, **resizable** via a drag handle; state persists in `localStorage`.
- **Mobile (≤767px):** the column becomes a **bottom sheet**: collapsed to a short bar, expands to ~80vh when “open.”

The main content area (`AppSurface`) and the agent column sit side-by-side in a flex **layout** (`App.svelte`). On small screens the main surface gets bottom padding so content isn’t hidden behind the collapsed chat bar.

### Surface context → agent

Whichever tab is active drives `**SurfaceContext`** (`router.ts`): today’s date, open wiki path/title, email thread id/subject, calendar date, or inbox summary mode. That context is serialized to a string for the agent (`contextToString`) so the model knows what the user is looking at.

### Rich chat (already started)

The chat is intentionally **not plain text**:

- **Markdown** in assistant messages, with special links:
  - `[label](wiki:path)` → rendered as buttons that open the wiki (`markdown.ts`).
  - `[label](date:YYYY-MM-DD)` → opens the calendar for that date.
- **Referenced** strip at the bottom of the transcript (`AgentConversation.svelte`): chips for **wiki paths** and **emails** inferred from tool usage and wiki links (`extractReferencedFiles`, `extractReferencedEmailChips` in `agentUtils.ts`).
- **Tool traces** (expandable) for transparency.
- **DayEvents** can appear inside messages where relevant (e.g. calendar tooling).

Opening a wiki path or email from chat today **navigates the main tab** (e.g. `openWikiDoc` / `openEmailFromSearch` in `App.svelte`) while the drawer stays available.

### Global search overlay

`Search.svelte` is a **modal** on top of the shell; it can open wiki paths or emails and then closes—another entry point into the same tabbed surfaces.

---

## Problems the current model solves

- **Clear mental model:** email, wiki, and calendar each have a familiar “app within the app.”
- **Deep linking:** URLs map cleanly to inbox threads, wiki paths, and calendar dates.
- **Agent always visible** (or one tap away on mobile) without leaving the “primary” task on the left.

---

## Limitations (why rethink)

- **Cognitive split:** the “center of gravity” is ambiguous—is the product the Today dashboard, or the agent? Tabs duplicate capabilities the agent can already reach via tools (`ripmail`, wiki file tools, calendar cache).
- **Navigation cost:** moving between chat and a document often means **tab switches** or route changes instead of a single focused flow.
- **Scaling richness:** as chat gains more inline affordances (references, previews, future widgets), maintaining **parallel full-page UIs** for every data type may duplicate work and feel heavy compared to a **single stream** that opens detail on demand.

---

## Proposed direction: chat-first, “Google-simple” shell

### Core idea

Treat the product like **Google Search** in spirit:

- **One primary input** (the conversation)—simple default UX: “ask your brain.”
- Over time, the system returns **rich, structured units** in the thread: not only prose, but **cards, previews, calendar blocks, linked entities**—analogous to search results that sometimes include maps, showtimes, or knowledge panels without turning the whole product into separate “Map mode” / “Movies mode” apps.

The **tabs go away** as top-level navigation. The **home route is the chat** (full width or dominant column). Secondary UIs become **transient layers**:

- Tapping a referenced **wiki doc** or **email** (or an LLM-placed link) **slides a detail panel in from the right** (or uses an equivalent pattern on narrow viewports: full-screen sheet with clear **Back** to the conversation).
- **Back** returns to the chat transcript; history can mirror browser **history** (`pushState` / `popstate`) so deep links and the system back gesture stay coherent.

### Agent-driven opening: `open` tool

Add an `**open` tool** (name TBD) so the **LLM can explicitly open** a wiki path, email thread id, or calendar date in that detail layer—without the user tapping. This aligns server-side behavior with the same navigation primitive the UI uses for taps, keeping **one code path** for “show this artifact.”

Design constraints to decide early:

- Whether `open` is **silent** or **announced** in the transcript (e.g. a small system line: “Opened *Notes/foo.md*”).
- Whether multiple stacked panels or a **single** detail at a time (simpler).

### Inline widgets (calendar and beyond)

The **calendar** view today is a strong standalone screen (`Calendar.svelte`, `DayEvents.svelte`). In a chat-first model, the same visual language can appear as **inline widgets** in the message stream when the user (or agent) focuses on scheduling—e.g. week strip, day agenda, or event detail card—reusing components rather than forcing a route change.

Same pattern could extend to **inbox snippets**, **wiki excerpt cards**, etc., always with a path to **expand** into the slide-over for full content.

### What happens to Today / Inbox / Wiki / Calendar “apps”?

They need not disappear as **code**; they become:

- **Embeddable views** (widgets + slide-over readers), and/or
- **Reachable via search and `open`**, and/or
- **Optional overflow** (e.g. a minimal “Library” entry for power users) if everything in tabs is removed.

The product decision is how much **browsing** (scan all mail, browse wiki tree) remains first-class versus **query + agent** as the default. A middle ground is chat-first **index** plus a **command palette** or search that jumps to structured browsers only when needed.

---

## Alignment with product vision

`VISION.md` stresses a **personalized assistant** grounded in email, calendar, and wiki—not a generic chatbot. A chat-first shell doubles down on **conversation as the spine**, while rich inline content preserves **grounding** and **scanability**. The “Google” analogy is about **progressive richness from a simple entry point**, not about ads or web-scale search.

---

## Implementation notes (non-binding)

- **Routing:** replace tab-only `Route` with something like `{ view: 'chat' }` + optional `{ overlay: 'wiki' | 'email' | 'calendar', ... }`, or encode overlay state in query/hash while keeping chat at `/`.
- **Shared primitives:** reuse `AgentConversation`, markdown link handlers, and existing API routes (`/api/wiki/...`, `/api/inbox/...`); refactor **navigation** so slide-over and `open` call the same helpers.
- **Agent:** register `open` in `src/server/agent/tools.ts`, validate arguments, return a structured result the client can interpret (or use SSE side-channel if needed—prefer one mechanism only).
- **Tests:** follow project rules—router and tool behavior deserve `*.test.ts` coverage.

---

## Open questions

1. **Offline / skim workflows:** Is full inbox or wiki tree browsing still required daily, or is search + chat enough?
2. **Mobile:** Is slide-from-right natural enough, or is full-screen modal + back always clearer?
3. **Multi-tasking:** Should users have **multiple chats** (sessions) exposed in UI, or one stream with optional branches later?
4. **Discoverability:** Without tabs, how do new users learn **sync**, **search**, and **wiki editing**? (Onboarding hints, persistent lightweight chrome, or command palette.)

This doc is a **concept summary** for discussion; it does not commit the codebase to a specific timeline or API shape.