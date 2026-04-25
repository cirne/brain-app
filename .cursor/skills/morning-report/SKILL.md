---
name: morning-report
description: >-
  Produces a concise daily stand-up: surveys inbox and calendar, correlates the vault wiki for what
  is top of mind, and prepares the user for the day with priorities and suggested wiki documents to
  create or update before key meetings. Use when the user asks for a morning report, daily brief,
  start-the-day prep, "what’s on today," or similar; not for a single meeting deep-dive (use briefing).
---

# Morning report

A **fast, scannable daily orientation** in chat: what matters in mail, on the calendar, in the wiki, and what to do next. It is **not** a full research project—keep it tight; offer `/research` or the **briefing** skill for heavy synthesis on one topic.

## Preconditions

- Use available tools: **calendar** (events for today and tomorrow if useful), **inbox/ripmail** (list, search, light read of threads that look blocking), and **wiki** (search/read pages the user already maintains: projects, people, standing notes).
- If a capability is missing (e.g. no mail connected), say so once and continue with what works.

## Workflow

1. **Scope the day** — User’s local "today" (timezone from context). Optional: they may name a focus (travel day, deep work, deadline).

2. **Calendar** — Pull events for today (and the next business day if tomorrow has hard deadlines or travel). Summarize: fixed blocks, conflicts, prep-heavy meetings, and **deadlines** visible in titles/locations. Flag **back-to-backs** and **long unbroken focus gaps**.

3. **Inbox** — High-signal pass only: **urgent** (deadlines, boss/client, money/legal), **threads awaiting reply**, **action items** in recent mail. Do **not** run full **inbox_triage** unless the user asked to clear the inbox; link patterns only ("several messages from X about Y").

4. **Wiki correlation** — Search/read wiki pages that relate to **today’s** meetings, open projects, and recurring themes. Call out: existing notes that are **stale** (old dates, superseded status), **missing** pages the user will wish they had in-room (e.g. decision log, agenda, stakeholder map), and **links** between wiki and calendar (same project names, people).

5. **Top of mind** — Short synthesis: 3–7 bullets tying **mail + calendar + wiki** (what to remember, what could go wrong, what to verify).

6. **Prep for the day** — Actionable, ordered: **now / before lunch / before EOD**, including "block time for X" when needed.

7. **Document suggestions** — Concrete **create or update** ideas tied to **specific meetings or outcomes**, e.g. "Before the 2pm product review, add a bullet to `[[projects/foo]]` for the open risk" or "Stub `[[people/new-vendor]]` with questions from the thread." Prefer wikilinks the repo uses (`[[path]]`). If a topic needs deep multi-source research, point to **research** (or `/research`) instead of doing it all inside the morning report.

## Output format

Use clear headings, short bullets, and **bold** for times and must-not-miss items. End with a one-line **"If you only do one thing"** when helpful.

## Related skills

- **calendar** — scheduling and event queries; same tool surface for "today."
- **inbox_triage** — if the user pivots to clearing noise or batch rules, switch to that playbook.
- **briefing** — for one meeting or event, deep attendee and context prep, not the whole day.
