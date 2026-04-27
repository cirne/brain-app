---
name: morning_report
label: "Create a scannable stand-up from mail, calendar, and notes"
description: >-
  Produces a tight daily stand-up: mail, calendar, and wiki in short bullets, then
  tappable next-step options via the suggest_reply_options tool. For one meeting
  in depth, use the briefing skill.
hint: start my day, daily brief, what’s on, priorities, prep for today
args: >-
  Optional focus (e.g. travel day, deadline crunch, deep work) or time zone note.
---

# Morning report

A **fast, scannable** daily snapshot in chat—not a research paper. **Density over breadth**: only what changes decisions today. Deeper work belongs in **briefing** (one meeting) or **research** (durable wiki).

## Preconditions

- Use available tools: **calendar**, **inbox/ripmail** (light pass), and **wiki** (search/read) as needed.
- If something is unavailable (e.g. no mail), **one** line and move on.

## Workflow

1. **Scope** — Local “today” (timezone from context). Optional one-line user focus.
2. **Calendar** — Today; add tomorrow only if it blocks today (hard deadline, travel). **Fixed times + one phrase each**; flag back-to-backs in one line.
3. **Inbox** — **At most 4 bullets**: urgent, awaiting reply, money/legal if any, and one “pattern” line if helpful. **Not** full **inbox_triage** unless the user asked.
4. **Wiki** — **At most 3 bullets**: stale or missing pages that matter **today**, or links to people/projects on the calendar.
5. **Top of mind** — **3–5 bullets** tying mail + calendar + wiki (risks, must-verify).
6. **Today’s order** — **now / before lunch / before EOD** with **1–2 items per bucket** (drop the bucket if empty).

## Output format (tight)

Use **short headings** and **single-line bullets** where possible. **Bold** times and can’t-miss items.

- **At most ~6 sections** (e.g. At a glance, Calendar, Inbox, Wiki, Top of mind, Today).
- **No long paragraphs**; no re-reading the same fact in two sections.
- **Optional** one line: **If you only do one thing, …** when it’s genuinely clarifying; otherwise skip.
- **Do not** end the message with a long “you could also…” list or duplicate wiki to-do ideas in prose—those go in **`suggest_reply_options`** (below).

**Length:** aim for a **small** on-screen read (roughly **under ~35 lines** of markdown for a normal day). If the day is huge, **compress** (merge bullets, cut nice-to-haves) instead of growing the reply.

## Finish (required)

1. **After** all other tool calls (calendar, inbox, wiki, etc.) and **after** the markdown body is written, end the turn with **exactly one** call to **`suggest_reply_options`**.
2. Provide **2–5** `choices` (max 8 allowed by the tool). Each **`label`** is a short chip (≤60 characters). Each **`submit`** is the full user message to send on tap (≤1000 characters)—concrete, e.g. a **briefing** for a specific meeting, **/research** with scope, **/wiki** with path, "Open …", or "Run morning_report with focus on …".
3. **Never** paste the same options as a bullet list, JSON, or fenced block in the assistant text—the app renders chips from the tool only.
4. Skip **`suggest_reply_options`** only when there is no reasonable next step (rare for a normal workday).

## Related

- **briefing** — one meeting or event, deep prep.
- **inbox_triage** — if the user pivots to rules and batch clearing.
- **calendar** — schedule fixes.
