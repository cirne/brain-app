---
name: inbox_triage
label: "Clear inbox noise and act on what matters"
description: >-
  Proactive triage: fetch → cluster noise by pattern → mute or archive in batches
  → act on what's left in priority order (reply, forward, archive). Nothing is lost—
  search always finds archived mail.
hint: triage my inbox, clear the inbox, find spam, improve signal to noise, bulk archive, walk my mail
args: >-
  Optional: account, time range, or goal (e.g. "newsletters / last 7 days / before vacation"). None required.
---

# Inbox triage

Use **list_inbox**, **search_index**, **read_email**, **archive_emails**, **inbox_rules**, **draft**, and **send**. This skill is a **phased, proactive playbook**: reduce noise in batches first, then invest attention where it matters—turn by turn until the user stops or the scoped queue is empty.

**Mindset:** you **fetch and scan first** (do not make the user enumerate mail), you **name patterns** in plain English ("GitHub notifications", "LinkedIn digests"), you **order by impact**, and you **default to one strong primary action** while offering clear alternates.

**The two actions:**
- **Mute** — archive now + suppress similar ones going forward (primary default; use **inbox_rules** internally to make it stick). Say it as "Mute these" not "create a rule."
- **Archive** — archive this thread only, no future suppression.

Never surface "rules" as a concept to the user. Use **inbox_rules** behind the scenes; present outcomes in plain language.

**Reassurance (one line, naturally):** archived mail is still searchable—nothing is gone.

---

## Phase 0 — Scope and fetch

1. If account, window, or goal is unclear, **ask once** (or pick a sensible default, e.g. last 7–14 days, and state it).
2. **Fetch** with **list_inbox** and/or **search_index**. You load the inbox—the user should not have to paste threads.

---

## Phase 1 — Cluster noise and propose mutes (batch signal boost)

1. **Scan** for likely noise: marketing, noreply blasts, automated alerts, newsletters, mailing lists, repeated low-signal senders.
2. **Cluster** by pattern: sender, domain, subject prefix, newsletter signatures, "do-not-reply" traffic. Name each cluster in plain English.
3. Present clusters as **mute proposals**—not one-by-one, in a batch. Lead with the highest-impact cluster. Example:

   > I found a few patterns worth muting:
   > - **GitHub notifications** (23 messages) — mute these?
   > - **LinkedIn digests** (11 messages) — mute these?
   > - **Stripe receipts** (8 messages) — mute or just archive?

4. Offer a **strong primary** and clear alternates:
   - **Primary:** "Mute all of these — archive what's here, suppress similar ones going forward"
   - **Subsets:** "Just GitHub notifications", "All except Stripe", etc.
   - **Escape:** "Skip for now — show me my actual mail"

5. On confirmation — apply **inbox_rules** (ignore action) for each muted pattern, then **archive_emails** for all matches. Re-fetch. In the same turn: say what's left (counts + examples) and move to Phase 2.

**Safety:** list what you will affect when a batch is large or ambiguous (e.g. "~40 threads"). No send in this phase.

---

## Phase 2 — Remaining noise: anything safe to bulk-clear?

1. From the post-mute set, **separate** what is still clearly low-signal (stale promos, ancient FYI) from what deserves attention.
2. If there is a material clearable bucket, recommend bulk archiving it:
   - **Primary:** "Archive all of these (N) — you can search any of them anytime"
   - **Alternates:** "Show me the list first", "Skip — go item by item"
3. After the user's choice, act and move to Phase 3.

---

## Phase 3 — Priority pass (what's left, one at a time)

Work in priority order (deadlines, people who matter, money/legal, "waiting on you", then the rest). For each thread:

1. **Short context:** who, subject, age, why it might matter (or why it is probably skippable).
2. Propose **the most useful action** — go past "just archive":
   - **Reply:** draft a short reply (RSVP, acknowledgement, decline, clarifying question). Show the draft before any send.
   - **Forward** to someone inferable from context.
   - **Archive** — sensible default for true noise.
   - **Mute** — if this looks like a repeating pattern the user hasn't dealt with yet.
3. Last option: **"Leave it — I'll deal with it later"** (no shame).
4. **On reply/send confirmation:** archive the thread automatically — no prompt needed. A sent reply means it's handled.
5. **Honour the tap** — execute, then advance to the next item. Keep moving unless the user says stop or the queue is empty.
6. No send without the user seeing the draft and confirming.

---

## Session wrap-up

When the scoped queue is empty or the user stops, briefly say what changed:

> "Your inbox is cleaner — I muted GitHub notifications, LinkedIn digests, and Stripe receipts going forward. 4 threads are still in your inbox."

This is the payoff moment. Name patterns, not rules.

---

## Multi-turn flow

- **Loop:** noise clusters → optional bulk clear → priority queue → act → next.
- **Memory:** use the transcript; re-query if stale or after big batches.
- **Escalation:** if the user asks a free-form question or changes topic, answer normally; resume triage when they return.

---

## When things go wrong

- **Tool errors** — say what failed; offer retry smaller, skip batch, or read one thread first.
- **Uncertain identity** — read one thread before a risky bulk action, then offer options.
- **User fatigue** — offer "Pause here; resume later" alongside one small next step.
