---
name: morning_report
label: "Create a scannable stand-up from mail, calendar, and notes"
description: >-
  Produces a concise daily stand-up: surveys inbox and calendar, correlates the vault wiki for what
  is top of mind, and prepares the user for the day with priorities and suggested wiki documents to
  create or update before key meetings. For a single meeting deep-dive, use the briefing skill.
hint: start my day, daily brief, what’s on, priorities, prep for today
args: >-
  Optional focus (e.g. travel day, deadline crunch, deep work) or time zone note.
---

# Morning report

A **fast, scannable daily orientation** in chat: what matters in mail, on the calendar, in the wiki, and what to do next. It is **not** a full research project—keep it tight; use **research** (or `/research`) for deep synthesis on one topic, or **briefing** for one meeting’s attendee and context prep.

## Preconditions

- Use available tools: **calendar** (events for today and tomorrow if useful), **inbox/ripmail** (list, search, light read of threads that look blocking), and **wiki** (search/read pages: projects, people, standing notes).
- If a capability is missing, say so once and continue with what works.

## Workflow

1. **Scope the day** — User’s local "today" (timezone from context). Optional: a named focus (travel, deep work, deadline).

2. **Calendar** — Events for today (and next day if it holds hard deadlines or travel). Summarize fixed blocks, conflicts, prep-heavy meetings, **deadlines** in titles/locations. Flag **back-to-backs** and long **focus gaps**.

3. **Inbox** — High-signal pass: **urgent** (deadlines, key senders, money/legal), **threads awaiting reply**, **action** items in recent mail. Do **not** run full **inbox_triage** unless the user asked to clear the inbox; summarize patterns only.

4. **Wiki correlation** — Search/read wiki pages for **today’s** meetings, open projects, recurring themes. Note **stale** pages, **missing** pages the user will want in-room, and **links** between wiki and calendar (same project names, people).

5. **Top of mind** — 3–7 bullets tying **mail + calendar + wiki** (remember, risk, verify).

6. **Prep for the day** — Actionable, ordered: **now / before lunch / before EOD**, including "block time for X" when needed.

7. **Document suggestions** — **Create or update** ideas tied to **specific meetings**, with `[[wikilinks]]` where the product uses them. If a topic needs multi-source research, point to **research** instead of doing it all here.

## Output format

Clear headings, short bullets, **bold** for times and must-not-miss. End with **"If you only do one thing"** when helpful.

## Related

- **briefing** — one meeting or event, deep prep.
- **inbox_triage** — if the user pivots to batch rules and clearing noise.
- **calendar** — for scheduling detail.
