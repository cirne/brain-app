---
name: trip-sheet
description: >-
  Builds a one-page trip summary from calendar, email, and wiki: reservations and confirmations
  (flights, hotels, cars), check-in and gate times, and door-to-terminal timing using the user’s
  known home or start address when available. Use when the user asks for a trip sheet, travel
  summary, packing list context, or "when should I leave for the airport"; not for general day prep
  (use morning-report) or a single meeting brief (use briefing).
---

# Trip sheet

A **structured travel digest** for an **upcoming trip** (next trip the user names, or the next multi-day travel block on the calendar). Goal: one scannable view of **what is booked**, **when to show up**, and **when to leave home** so they are not late.

## Preconditions

- Pull from **calendar** (travel events, flights as blocks, hotel stays, rentals), **email** (airline/hotel/car confirmation threads, PNR-style mail), and **wiki** (trip notes, `[[travel/...]]`, city pages, packing lists, **`me.md`**).
- **Where they leave from** — For the first leg’s **leave-by** time, **default** the origin to the **hometown / home base** in **`me.md`** (read the file; use what it says, without inventing detail). **Override** that default if the **calendar** or **other trip sheets / travel wiki pages** show the trip starting elsewhere (e.g. already in another city, OOO there before the flight, inbound leg from a prior stop). The **user’s message** overrides if they name a start point. **Do not invent** a street address; only use text from `me.md`, other wiki, chat, or calendar. If nothing grounds an origin, state the gap and still give **relative** buffers (e.g. "arrive terminal ~2h before domestic").

## Workflow

1. **Scope the trip** — Destination, dates, and trip name if the user gave one; else infer the **next** trip from calendar + mail in the near future (ask one clarifying question if two trips compete).

2. **Calendar** — List flight times, hotel check-in/out if on calendar, car pickup/return, timezone changes, and **all-day** or **OOO** blocks.

3. **Email** — Search for confirmation patterns: airline (itinerary, check-in reminders), hotel, rental car, trains, ride receipts. Extract **confirmation codes** (last four or full when safe to repeat), **seat/room** notes, and **links** to manage booking if present.

4. **Wiki** — Tie in existing trip pages, contacts at destination, or research already saved; flag **gaps** (no hotel found, missing return flight).

5. **Reservations table (mental or markdown)** — For each leg: **what**, **when (local time + timezone)**, **where** (airport code, address, terminal if known), **record locator / conf #** if present, **status** (confirmed vs unverified).

6. **Check-in times** — **Airline**: online check-in window; **airport**: recommended arrival before departure (domestic vs international). **Hotel**: check-in/out times and late-arrival note. **Car**: pickup location hours.

7. **Leave-by / travel time** — For the **outbound** first leg of this trip (e.g. home → airport):
   - **Origin** — same rule as preconditions: **`me.md` hometown by default**; **override** if the **calendar**, **other trip / travel wiki pages**, or the **user’s message** clearly imply a different “leaving from” (clarify only if still ambiguous).
   - **Drive or transit** from that origin to the departure airport — estimate duration (maps/web when available, else a **stated or reasonable** range in minutes; label it as estimate).
   - Add **parking, security, and terminal** buffer (typical 60–120+ min before departure depending on flight type; say what you assumed).
   - Output a line like: **"Plan to leave [origin] by ~8:00 AM** to make a **10:30 AM** departure from **[airport]**, allowing **[X] min** on the road + **[Y] min** buffer for parking and security" — adjust numbers to match the user’s profile (e.g. TSA Pre, small airport).

8. **Gaps and risks** — Missing confirmation, no hotel for last night, visa, return COVID rules if still relevant, daylight savings at destination.

9. **Finish (required)** — End every trip sheet by **persisting** it to the vault wiki, then **opening** that page in the app.
   - Use **`write`** to create a page under **`travel/<slug>.md`** (see **`travel/template.md`**) or **`edit`** if a page for this trip already exists. When the trip is over and the page is only historical, **`move_file`** to **`travel/archive/<slug>.md`** (see **`travel/archive/template.md`**).
   - Save the **full** digest as markdown in that file (all sections below).
   - Then call **`open`** with `target: { "type": "wiki", "path": "<the path you just wrote or edited>" }` so the user sees the trip sheet in the wiki pane. Only skip if the user clearly asked for chat-only and no saved document.

## Output format

- **Trip header** (dates, main destination, timezone).
- **Itinerary** (chronological, local times labeled).
- **Reservations** (bullets or small table).
- **Check-in & arrival** (deadlines in plain language).
- **Leave-by times** (from home or from hotel) with **assumptions** explicit.
- **Open items** (book X, print Y, add wiki stub).

(The **saved wiki page** is the deliverable; chat may echo a short preview.)

## Related skills

- **morning-report** — whole-day focus, not trip logistics.
- **briefing** — one meeting, not a multi-day trip.
- **calendar** — creating or moving travel blocks when the sheet exposes a fix.
