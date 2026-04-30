---
name: briefing
label: "Assemble a research brief for a specific meeting or event"
description: >-
  Pre-meeting or pre-event research: assembles context from email, web, and video when useful;
  explains purpose and participants; deep attendee notes for new or infrequent contacts, light touch
  for the user’s regular group; surfaces logistics (location, travel, meals, practicalities). The
  full write-up is saved to the vault wiki and opened—not pasted as a long chat reply. For a
  whole-day scan, use morning_report.
hint: before my meeting, who is X, prep for the call, context for the interview, event prep
args: >-
  Optional—meeting title, time, or attendees in natural language.
---

# Briefing (meeting or event)

A **single-meeting (or single-event) prep** document: purpose, history, who matters, what to ask, and **logistics** the user might not have considered. **Multi-source** research in proportion to stakes: **email**, **wiki**, **web**, **YouTube** (transcripts, official demos) as in **research**—the **deliverable is a saved wiki page**, not a wall of text in the assistant message.

## When to use

- "Brief me on …", "What should I know before …", customer call, interview, or internal review.
- **Not** for "how’s my whole day" — use **morning_report**.

## Attendees

- **First-time, rare, or external**: who they are, role, link to the topic, **1–3 conversation angles** (public + mail/wiki).
- **Regular collaborators** seen often: **no mini-bio**; only **what changed** or **why they are in *this* meeting**.

If unsure: one line for inner circle, short paragraph for rare/externals.

## Research lanes (parallelize when possible)

1. **Calendar** — title, time, location or link, description, invitees.
2. **Email** — threads by attendee, project name, or subject; read for decisions and open questions.
3. **Wiki** — `[[people/...]]`, `[[projects/...]]`, prior notes, decision logs.
4. **Web** — org/product pages, recent news, public context.
5. **YouTube / transcripts** — when recent talks or demos sharpen the meeting.

Cite or summarize in the page so the user can follow up. Prefer primary sources over hot takes.

## Substance

- **Purpose** and implied **decisions** vs what context suggests.
- **Stakes** only when grounded—label **inference** clearly.
- **3–5 questions** to ask; **one-liner** positioning for the user’s role.

## Logistics

When knowable or worth confirming:

- **Location** vs remote; **timezone** for distributed attendees.
- **Travel time** and **buffer** (back-to-back risk).
- **Meals** — spans lunch, all-day, eat-before vs on-site; dietary only if known.
- **Materials** — deck, NDA, badge, demo hardware.
- **Follow-ups** — recap, wiki note.

## Page body format (in the wiki file)

Write the full brief in markdown with this structure:

- **Event one-liner** (what / when / where).
- **Context** (tight bullets).
- **People** (compress regulars; expand rare/externals).
- **Risks / unknowns** (gaps).
- **Questions** and **logistics check**.
- **After the meeting** — optional line on which wiki page or section to update (if useful).

## Finish (required)

1. **Path** — `**write`** a new page, or `**edit`** if the user already has a note for this event (search wiki and calendar for an existing file). Default pattern: `briefs/<local-date>-<kebab-title>.md` (use the meeting’s local date from context). If the user’s vault already uses another convention (e.g. `meetings/…` or `notes/briefs/…`), follow that instead.
2. **Content** — Put the **entire** brief in that file (all sections above—not chat-only).
3. **Open** — Immediately after a successful `write` or `edit`, call `**open`** with `target: { "type": "wiki", "path": "<same wiki path you used>" }` so the page appears beside chat. Skip `open` only if the user explicitly asked for no preview.
4. **Chat reply** — At most a **very short** pointer in chat: which file you wrote and that it is open, or one sentence on the top risk. **Do not** paste the full brief in the chat message.

## Related

- **research** — deeper multi-page investigation and evidence hubs; also wiki-first, wider scope.
- **morning_report** — full-day; may mention a hard meeting, not a substitute for this depth.
- **email** — only if the user shifts to inbox clearing or filter tuning.
- **calendar** — to fix schedule when prep surfaces a conflict.