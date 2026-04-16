---
name: new
label: "New wiki page: placement, DRY, size, links"
description: >-
  Create a new wiki page in the right place: search for existing coverage first (one source of
  truth), link instead of duplicating, respect an agent-friendly size budget (split large topics
  into a hub plus linked pages), and ship clear structure with working internal links. Write files
  directly; do not stop at outlines unless the user asked for planning only.
hint: topic or working title; optional size budget
args: <topic> [max-lines]
version: 2
---

# New wiki page

Creating a page is the complement to **tidy** (refactor): you are **adding** a module. Use the same instincts as good code: one clear responsibility per file, no copy-paste, explicit imports (wikilinks), and sizes that fit in an agent’s context.

## When to use

The user wants a **new** markdown page in their wiki, placed correctly and aligned with how the rest of the wiki is organized.

## Size budget (agent-friendly)

Match **tidy** defaults so new pages do not become unmaintainable blobs:

- **Default `max-lines`:** about **400 lines** of markdown body (excluding frontmatter). If the user does not pass a second argument, design the **main** page to stay within this cap.
- **Override:** If the user passes `max-lines`, use it as the cap for the primary page.
- **When the topic is too big for one page:** Create a **hub** (outline + links) plus **child** pages for deep sections—same refactor pattern as tidy, but from a blank slate.

## Process

1. **Discover** — Search and read (wiki first, then email/web as needed). Identify canonical pages; do not recreate what already exists—link and extend instead.
2. **Place** — Pick a path under the wiki root that matches existing conventions (folders, naming). One obvious home for the topic; avoid parallel duplicates.
3. **Write** — Clear title, short intro, structured headings, scannable lists where they help agents and humans. State facts you can ground; avoid invention.
4. **DRY** — Prefer one canonical page per concept; if overlap exists, merge intent into the canonical page or add a short page that mostly points elsewhere with local context only.
5. **Size** — Keep the main page within the budget; split into linked pages if needed.
6. **Links** — Add wikilinks to related people, projects, and docs; use paths/titles consistent with the wiki. No orphan: add at least one inbound link from an index, parent, or related page when you create the file.
7. **Apply** — Create the file(s) through the wiki edit flow. Do not deliver only a proposal unless the user asked for planning only.

## Quality bar

- Accurate where factual; explicit about uncertainty.
- Deduped against the rest of the wiki; links instead of repeated blocks.
- Within the size budget, or deliberately split into a hub and children.
- Linked in: not an orphan; outbound links are valid and purposeful.
