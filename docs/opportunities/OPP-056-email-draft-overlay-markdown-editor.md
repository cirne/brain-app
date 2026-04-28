# OPP-056: Email drafts — overlay Markdown editor (wiki-class UX)

**Status:** Open  
**Tags:** `email` · `chat` · `ux` · `overlay` · `ripmail`  
**Related:** [OPP-019](OPP-019-gmail-first-class-brain.md) (Gmail + ripmail integration); [ripmail OPP-055](../ripmail/docs/opportunities/OPP-055-multipart-alternative-html-plain-outbound.md) (Markdown drafts → multipart outbound); [archive/OPP-016](archive/OPP-016-agent-chat-draft-queue.md) (deprioritized: composer-side draft queue — different problem); [BUG-028](../bugs/BUG-028-agent-email-draft-wrong-recipient-and-signature.md) (draft **content** — wrong recipient / signature despite overlay goals)

**Additional user feedback:** Issue **#13** (`2026-04-27`) — drafted mail had incorrect `To` and signature attribution; manual correction before send.

---

## One-line summary

When the user views or edits an **email draft**, open it in the **same slide-over / detail overlay** used for wiki documents and other referenced artifacts, with **in-place Markdown editing** (and explicit **Send** or equivalent), instead of forcing iteration entirely through chat transcript output.

---

## Problem

Today, draft workflows are largely **chat-output–only**: the agent’s tools surface draft text inside the message stream. To change a subject line, tweak a paragraph, or review the full message, the user must drive the conversation with natural-language instructions (“show the final draft,” “change the UK line to…”). Each round trip **re-emits** large blocks of text in chat.

That pattern is:

- **Slow** for small edits that would be a few keystrokes in an editor.
- **Hard to scan** when the transcript mixes reasoning, bullets, and the actual mail body.
- **Inconsistent** with how Braintunnel already treats **wiki pages** and other references: those open in the overlay panel for reading and editing, while chat remains the control surface.

Ripmail (and the bundled stack) already treats drafts as **Markdown** on disk with structured conversion for send ([ripmail OPP-055](../ripmail/docs/opportunities/OPP-055-multipart-alternative-html-plain-outbound.md)). The **data model** supports a real editor; the **UI** does not yet route drafts through the same “document surface” as the wiki.

---

## Proposed direction

### Primary UX

1. **Open draft in overlay** — When the user (or agent) “opens” the current draft, navigate the detail pane to a **draft document** view — analogous to `overlay.type === 'wiki'` in [`SlideOver.svelte`](../../src/client/components/shell/SlideOver.svelte) (see [`Assistant.svelte`](../../src/client/components/Assistant.svelte) overlay routing).
2. **Markdown editing** — Reuse the **wiki-authoring patterns** where possible: same editor component family, preview/edit toggles if the wiki uses them, keyboard-friendly editing — **do not build a parallel one-off rich editor** for mail-only.
3. **Explicit send (and safety)** — Chrome actions such as **Send** (and possibly **Discard / save-only**) live on the draft panel, aligned with how users expect mail clients to behave; optional confirmation remains compatible with agent-mediated send flows.
4. **Dual modality** — The user can still **refine via chat** (“make the tone warmer”); the agent applies changes to the **same underlying draft** that the panel shows, so chat and editor stay **in sync** rather than competing sources of truth.

### Implementation principles (no reinventing the wheel)

- Prefer **one Markdown editing stack** shared with wiki (components, save semantics, streaming edit hooks if already used for wiki agent edits).
- New work is mostly **routing + overlay type + binding draft id/path to the editor**, plus **API** to read/write draft content and trigger send — not a greenfield editor.
- Mobile: same overlay behavior as wiki detail (already handled in the shell); ensure touch editing and toolbar actions are usable on narrow widths.

---

## Non-goals (for this OPP)

- Replacing ripmail’s draft storage or send pipeline — **presentation and navigation** in brain-app first.
- [archive/OPP-016](archive/OPP-016-agent-chat-draft-queue.md) — always-on composer draft queue; orthogonal unless product later merges concepts.

---

## Open questions

- **Overlay identity:** dedicated `overlay.type` (e.g. `email-draft`) vs. a virtual wiki path — choose whichever minimizes duplication and keeps permissions clear.
- **Conflict resolution:** if the user edits in-panel while the agent streams a rewrite, define **last-write-wins** or **prompt-to-merge** behavior.
- **Threading:** showing **To/Cc/Subject** in the panel header vs. front-matter in Markdown — product decision tied to ripmail draft file format.

---

## Acceptance criteria (high level)

- User can open a draft from chat context (tool result or explicit control) and **edit Markdown in the overlay** without scrolling the transcript for the full body.
- **Send** (or configured primary action) is available from the draft panel when appropriate for the session/tool contract.
- Chat-driven edits and manual edits **converge on one draft state** visible in the overlay when open.
