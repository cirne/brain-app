---
name: inbox_triage
label: "Bulk-clear noise from your inbox and triage what remains"
description: >-
  Proactive triage: fetch → batch rules for low-signal senders → optional bulk archive of the rest
  → go through what remains in priority order with smart next actions (drafts, forward, schedule, rule)
  beyond plain archive. Nothing is lost—search and recovery always work.
hint: triage my inbox, clear the inbox, find spam, improve signal to noise, bulk archive, walk my mail
args: >-
  Optional: account, time range, or goal (e.g. "newsletters / last 7 days / before vacation"). None required.
---

# Inbox triage

Use the same **mail and inbox tools** as the main assistant (**list_inbox**, **search_index**, **read_email**, **archive_emails**, **inbox_rules**, **draft** / **send** where allowed). This skill is a **phased, proactive playbook**: reduce noise in batches first, then invest attention where it matters—turn by turn until the user stops or the scoped queue is empty.

**Mindset — "magical" here means:** you **fetch and scan first** (do not make the user enumerate mail), you **name patterns** (senders, subjects, "looks like X"), you **order by impact** (what unblocks the user or prevents mistakes first), and you **default to one strong primary action** while still offering subset, skip, and custom exits.

**Reassurance (say it when archiving or rules apply):** mail stays **indexed**; **search_index** and **read_email** still find it. Archiving and rules **change what surfaces first**, not what exists. The user can **recover** anything by search—**nothing is thrown away** by this flow unless they explicitly ask for **delete** and you confirm.

---

## Phase 0 — Scope and fetch

1. If account, window, or goal is unclear, **ask once** (or pick a sensible default, e.g. last 7–14 days in primary inbox, and state it).
2. **Fetch** with **list_inbox** and/or **search_index** to build a **working set** in scope. You are the one who **loads** the inbox; the user should not have to paste threads.

---

## Phase 1 — Find low-signal mail and **propose rules** (batch signal boost)

1. **Scan** the working set for **likely noise**: obvious spam, marketing, noreply blasts, repeated automated receipts/alerts, mailing lists the user plausibly does not need in the primary view, and **"low quality"** heuristics (clickbait subjects, no meaningful sender, bulk patterns).
2. **Cluster** by pattern: sender, domain, `List-*` / newsletter signatures, subject prefixes, "do-not-reply" traffic.
3. Propose **multiple concrete rules** (not one vague rule)—each with a **short human label** and **what it catches**. Prefer **inbox_rules** over one-off archive when a pattern is **repeating**. **List** existing rules first if needed so you do not duplicate.
4. Offer a **strong primary** option and clear alternates:
   - **Primary (recommended):** e.g. "Add all N rules, archive what matches, show the inbox that's left"
   - **Subsets:** "Add rules 1–2 only", "This rule only", etc.
   - **Escape:** "Skip rules; go to my mail as-is", "Only list candidates—don't change rules yet"
5. On confirmation — **apply** (**inbox_rules** add/edit as needed, then **archive_emails** for matches). **Re-fetch** the inbox in scope. In the same turn: briefly say **what's left** (counts + examples), then offer the next steps.

**Safety:** no **send** in this phase. Bulk archive is **explicitly** what the user chose; still **list what you will affect** if the batch is **large** or **ambiguous** (e.g. "~40 threads from these senders").

---

## Phase 2 — **Remaining** mail: what to clear in bulk?

1. On the **post-rules** set, **separate** what still looks **safe to clear without reading every line** (stale promos, obvious FYI, ancient notifications) from what deserves **a real decision**.
2. **Recommend** a bulk archive of the "clearable" bucket if it is **material**; otherwise **skip** this phase and go to Phase 3. If you do recommend bulk clear, offer:
   - **Primary:** e.g. "Archive all of these (N)—I can search any time"
   - **Alternates:** "Archive half / bottom priority only", "Show me a list first", "Don't bulk—go item by item"
3. **Remind** once: **search/recovery** is always available; this is about **inbox headspace**, not data loss. After the user's choice, **act** and offer next steps (Phase 3 or bulk sub-step).

---

## Phase 3 — **Priority pass** (what's left, one focus at a time)

Work **in priority order** (you set it: deadlines, people who matter, money/legal, "waiting on you", then the rest). For **each** current thread:

1. **Short context** in plain language: who, subject, age, **why it might matter** (or why it is probably skippable).
2. Propose **the most likely useful actions**—**go past "just archive"** when the text supports it, for example:
   - **Draft** a short reply: RSVP yes/no, acknowledge receipt, decline politely, ask a clarifying question, "thanks, handled".
   - **Forward** to someone in **user context**—only name people/addresses you **reasonably** infer.
   - **Unsubscribe + archive** (when safe and the user is clearly done with a list).
   - **New/updated rule** for this class of mail.
   - **Archive** or **mark handled** as the sensible default for true noise.
3. The **last** option is often: **"Leave in inbox—I'll deal with it later"** (no shame; preserves trust).
4. For **any draft reply** — include an option to use it; the `submit` should carry the **draft text or intent** so the next turn can call **draft** / prep **send** per policy.
5. **Honour the tap** — execute with tools, then **advance** to the **next** open item in the same scope. After each action, move to the next item unless they chose **stop** or the queue is empty.
6. **No send** without **plain-language confirmation**; an option may say "Confirm send: …" only after the draft is visible.

---

## Rules and durable taste (ripmail **inbox_rules**)

- Prefer **inbox_rules** for **repeating** patterns; use **remember_preference** only when a **rule** cannot represent it.
- **Actions** in rules: use **ignore** (or the closest match) when the goal is "out of the default signal path but still **searchable**"; use **notify** / **inform** when mail should stay visible in a lighter way.

---

## Multi-turn flow

- **Session loop:** noise batches → optional bulk clear → **priority queue** of threads → act → next.
- **Memory:** use the **transcript**; re-query the inbox if **stale** or after big batches.
- **Empty queue** — say the **scope** is **clear** and offer next steps: wider/narrower filters, inbox_rules review, done.
- **Escalation** — if the user **asks a free-form question** or **changes topic**, answer normally; when they return to triage, resume.

---

## When things go wrong

- **Errors from tools** — say what failed and offer retry options (retry smaller, skip batch, read one thread first).
- **Uncertain identity** — **read_email** for one thread before a risky bulk action, then offer options to continue.
- **User fatigue** — offer a "Pause here; resume later" option alongside one small next step.
