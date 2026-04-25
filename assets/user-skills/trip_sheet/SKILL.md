---

## name: trip_sheet
label: "Trip sheet: reservations, check-ins, leave-by times from home"
description: >-
  Summarizes an upcoming trip from calendar, email, and wiki. Surfaces flight, hotel, and car
  reservations and confirmations, check-in and terminal timing, and door-to-leave times using the
  user’s known home or start point (never invent an address). For a single meeting, use briefing; for
  a full day at home, use morning_report.
hint: trip summary, when to leave for the airport, travel confirmations, hotel check-in, itinerary
args: >-
  Optional trip name, destination, or date range in natural language; otherwise infer next trip
  from calendar and mail.

---

# Trip sheet

A **structured travel digest** for an **upcoming trip** (named by the user, or the next clear travel block from calendar + mail). **Calendar**, **email** (ripmail search/read), and **wiki** (trip or city notes) together. Goal: **what is booked**, **when to check in**, and **when to leave** so the user is not late.

## Address and privacy

- **Where they leave from (first leg)** — Decide the **departure point** for leave-by and drive time before the numbers:
  - **Default:** Read `**me.md`** and use the **hometown / home base** there (city, region, or street as written) as the assumed “leaving from” for the outbound leg. State that assumption in the trip sheet.
  - **Override the default** when the **calendar** or **other trip wiki pages** (e.g. `travel/…`, past trip sheets) clearly imply a different start: multi-city order, OOO in another place before the flight, or the trip block beginning away from home.
  - The **user’s message** wins if they name a start city or address.
- For **any** home or start address, use **only** what appears in those sources—**do not** fabricate a street address.
- If no usable home is in `me.md` and nothing else implies an origin, give **relative** guidance (buffers, “typical” drive range) and **one** ask to pin the start point for a precise **leave-by** time.
- For drive time, use **web/maps** or reasonable estimates; **label** estimates.

## Workflow

1. **Scope** — Trip name, destination, and dates, or infer the next trip; clarify if two trips tie.
2. **Calendar** — Flights, hotels, cars, OOO, timezone; note anything only in mail.
3. **Email** — Search confirmations: airlines, hotel, rental, ground transport. **Confirmation codes** and key details; avoid dumping full PII beyond what the user needs in view.
4. **Wiki** — Link `[[...]]` trip pages, packing notes, people at destination.
5. **Reservations** — For each: what, when (local + TZ), where, conf/ref, status.
6. **Check-in** — Web check-in window; **arrive at airport** before departure (domestic vs intl). Hotel check-in/out. Car counter hours.
7. **Gaps** — Missing segment, unconfirmed night, documents.
8. **Finish (required)** — The trip sheet is not done until it lives in the wiki and is open in the UI.
  - `**write`** a new page or `**edit**` an existing one if this trip already has a page (re-use paths you find in wiki search or that the user linked). Prefer paths like `travel/<destination-or-trip-slug>.md` or `trips/<year>-<destination>.md` (kebab-case; include `.md` in tool args as the product expects).
  - Put the **full** trip sheet body in that file (same sections as below—not chat-only).
  - Immediately after the write or edit succeeds, call `**open`** with `target: { "type": "wiki", "path": "<same wiki path you used>" }` so the user sees the page beside chat. Skip only if the user explicitly asked for a chat-only answer with no saved page.

## Output format

- Header (dates, destination, key TZ).
- Chronological **itinerary**.
- **Reservations** and **check-in / arrive-by**.
- **Leave-by** with explicit assumptions.
- **Open items**.

(You may add a **short** summary in chat, but the canonical artifact is the wiki page you wrote and opened.)

## Related

- **briefing** — one meeting.
- **morning_report** — whole workday, not travel logistics.
- **calendar** — fix schedule if the sheet shows conflicts.

