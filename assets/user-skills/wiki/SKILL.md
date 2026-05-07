---
name: wiki
label: "Create, tighten, or restructure pages in your vault wiki"
description: >-
  Umbrella for all wiki work: create a new page in the right place; lint and refactor one page
  (accuracy, DRY, size, links, format); or prune a subtree (duplicates, orphans, structure). Examples:
  “add a page for our Q3 roadmap under projects/”; “clean up ideas/foo.md and remove duplication with
  index”; “prune the notes/ folder—merge duplicates and fix orphans”. Route from the user’s words;
  do not require structured parameters. If they only need to find where something is mentioned, use
  normal chat instead of this skill. For multi-source investigation that becomes a durable write-up,
  prefer /research.
hint: describe the wiki task in your own words
args: >-
  Optional natural language: topic, path, folder, constraints, or a line budget (e.g. “keep under
  300 lines”). Defaults below apply when unspecified.
---

# Wiki (umbrella)

This skill covers **creating** pages, **tidying** a single page, and **pruning** a subtree—same quality bar everywhere: one source of truth, agent-friendly page sizes, working links.

## When to use this skill vs plain chat vs /research

- **Plain chat:** “Where did I put X?” “What mentions Y?”—search/read/grep without a dedicated recipe.
- **`/wiki`:** The user wants **edits or structure** on wiki files—new content, refactor, or tree-level cleanup.
- **`/research`:** Thorough multi-source investigation synthesized into **durable wiki pages** (see that skill). Quick one-off lookups stay in chat.

## Natural-language routing

Infer the mode from what the user wrote after `/wiki`:

| Intent | Route to |
| --- | --- |
| New page, new topic, “add a page”, “document X” | **Create** flow below |
| One page feels messy, wrong, too long, “fix this file” | **Tidy** flow below |
| Area or folder is messy, duplicates, orphans, “clean up notes/…” | **Prune** flow below |

If multiple modes apply, do the minimum that satisfies the ask; say what you did in a short closing note.

## Shared defaults (all modes)

- **Line budget:** Aim for about **400 lines** of markdown body per primary page (excluding frontmatter). If the user names a different cap, honor it. If the topic is too big: **hub** page plus **child** pages with links—refactor, do not merely compress.
- **DRY:** Prefer one canonical page per concept; link instead of copying blocks.
- **Apply:** Write through the wiki edit flow. Do not stop at outlines unless the user asked for planning only.
- **Vault format:** This is an **Obsidian-style vault**. Cross-link pages with **`[[wikilinks]]`** — drop the `.md` extension. Use the path relative to the wiki root, e.g. `[[me]]`, `[[people/jane-doe]]`, or `[[projects/foo|Foo]]` to override the displayed label. Do **not** use plain markdown `[label](path.md)` links between wiki pages. External URLs still use standard `[label](https://…)` markdown.

---

## Mode: create (new page)

You are **adding** a module: one clear responsibility per file, wikilinks as “imports,” sizes that fit context.

1. **Discover** — Search/read wiki first; identify canonical pages. Do not recreate—link and extend.
2. **Place** — One obvious path under the wiki root matching existing conventions.
3. **Write** — Clear title, intro, structure; ground facts; avoid invention.
4. **Links** — Obsidian-style `[[wikilinks]]` to related pages (no `.md`); **no orphan:** add at least one inbound `[[…]]` link from an index, parent, or related page.

## Mode: tidy (one page)

**Lint + refactor** for prose: truth, deduping, navigation, readable size.

1. **Load** — Read the target and related pages; scan for duplicate or conflicting statements.
2. **Accuracy** — Fix or qualify; remove unsupported claims rather than guessing.
3. **DRY** — Single source of truth; replace copies with summary + link.
4. **Size** — Enforce budget; split into linked pages when over (hub + children).
5. **Links & format** — Fix broken links; convert any plain `[label](path.md)` cross-page links into `[[path]]` wikilinks; improve headings and scanability.
6. **Apply** — Edit in place (and new files when splitting).

## Mode: prune (subtree / structure)

**Tree** scope: how pages relate—duplicates, orphans, stale or oversized pages. Same DRY/size instincts as tidy.

1. **Map** — List pages in scope; note staleness when inferable.
2. **Classify** — Obsolete, duplicate, orphan, merge candidate, oversized, or keep.
3. **DRY** — Pick a **canonical** page; merge content; stub+link losers when appropriate.
4. **Structure** — Fix orphans with `[[wikilinks]]` from indexes/parents; fix paths when wrong; normalize stray markdown `[label](path.md)` cross-page links to `[[path]]`. For stale **temporal** pages (old trips, superseded meeting scratch), prefer **`move_file`** to **`travel/archive/`** or **`notes/archive/`** (read that folder’s **`archive/template.md`**) before delete; after moves, fix inbound **`[[wikilinks]]`** from **`[[index]]`** or hub pages.
5. **Apply** — **Execute** non-destructive fixes: merges, links, moves/stubs your tools support.
6. **Safety** — **Ask first** before permanent deletion, **bulk delete**, or anything that loses history without archive. Never mass-delete without explicit user approval.
7. **Report** — Brief summary of changes and anything needing a human decision.

## Quality bar

- Measurable improvement: accurate, deduped, right-sized (or deliberately split), well-linked.
- Prune: minimal surprise; prefer merge/stub/link over delete when history or inbound links matter.
