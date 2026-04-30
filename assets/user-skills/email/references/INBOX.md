# Inbox, filters, and missing mail (Brain tools)

Companion to the [email](../SKILL.md) skill. Covers **what the inbox shows**, **filters** (ripmail inbox rules — say “filters” or “what’s hiding mail,” not JSON file names), and **why an expected message didn’t surface**.

---

## Mental model

- **`list_inbox`** — Same deterministic triage the Hub uses for the inbox panel (rules + fallback). Not the same as searching the entire mail index.
- **`inbox_rules`** — List, inspect, validate, add, edit, remove, reorder rules. Wraps **`ripmail rules`** with structured params (see tool description for `query` vs `from`/`subject`/`category`).
- **`search_index`** — Finds messages **even when** they were deprioritized or archived locally; use to prove mail exists before blaming “sync.”

---

## Proactive path (triage rhythm)

1. **`refresh_sources`** when recency matters.
2. **`list_inbox`** — normal call (no `thorough`) for what the user should see in the primary inbox experience.
3. **`archive_emails`** when the user is done with items (ids from `list_inbox` or `search_index`).

### Suggested next steps (chat / chips)

Almost always include **archive** among follow-ups once you’ve surfaced mail: readers usually want to clear what they’ve **seen** (**`notify` / `inform`**) — e.g. a receipt after they acknowledge it — not buried promo rows the triage bucket already labeled **ignored**. Prefer **Archive [that message]** / **Archive the payment/receipt thread** before **bulk-archive promos** unless they asked for noise cleanup or those items still eat real attention. Few items → one or two crisp archive chips; many → “archive everything shown here” plus optional drill-down.

After changing filters with **`inbox_rules`**, run **`list_inbox`** again so the assistant and user see updated results. (For large mailboxes, ripmail’s CLI also supports `inbox --reapply` to re-classify already-indexed mail; Brain may not expose that flag on every path—if behavior still looks stale after a rule fix, note that a deeper re-triage might be needed from the Hub or a future tool update.)

---

## Reactive path — “I expected that email in my inbox”

**User-facing language:** Talk about **filters** (or “what the app is hiding”), not `rules.json`, rule IDs, or SQL.

1. **Confirm the message exists** — **`search_index`** with subject, sender, or keywords the user gives you.
2. **See how triage classified it** — **`list_inbox`** with **`thorough: true`**.  
   Thorough mode asks ripmail for a deeper inbox pass: suppressed / ignored-style candidates often appear with fields such as **`winningRuleId`** / **`decisionSource`** so you can tie a message to **which filter** won.
3. **Inspect the filter** — **`inbox_rules`** with **`op=show`** and **`rule_id`** from that message (or **`op=list`** and match by id).
4. **Explain in plain language** — e.g. “A filter that matches mailing-list mail from X was set to hide those messages.”
5. **Offer fixes** (after user consent):
   - **`op=edit`** — narrow the filter (tighter `from`, `subject`, `query`, or action).
   - **`op=remove`** — delete a filter that’s too broad.
   - **`op=add`** — add a **more specific** filter **earlier** in the list (higher priority) to **allow** the important sender/thread (see tool docs for ordering / `move`).
6. **Verify** — **`list_inbox`** without `thorough` to confirm the message now surfaces for the user’s default view when appropriate.

If **`search_index`** finds nothing, the problem is sync, wrong account, or wrong query — not filters.

---

## Diagnostics trust

- Prefer **`winningRuleId`** / **`decisionSource`** from **`list_inbox`** output over guessing.
- If thorough output is empty or ambiguous, fall back to **`inbox_rules`** list + comparing the message’s headers to each filter’s conditions—**last resort**, more error-prone.

---

## Proactive bulk triage (clear noise)

Use when the user wants to **clean the inbox** or **raise signal**, not trace one missing mail. Same tools (`list_inbox`, `search_index`, `archive_emails`, **`inbox_rules`**, drafts). **Mindset:** fetch first — do not ask the user to paste threads. Name clusters in plain English (**never** expose “rules” as a jargon term).

**Mute** (default for repeating noise) = archive what’s here now + **`inbox_rules`** with **`ignore`** so similar mail stays deprioritized. Say **“Mute these”**, not “add a rule.” **Archive-only** = this thread disappears from the inbox scan with **no future suppression.**

### Phases (high level)

1. **Fetch** — `refresh_sources` if needed → `list_inbox` (+ `search_index` if the scope isn’t inbox-shaped).
2. **Cluster noise** — marketing digests, noreply bursts, newsletters, obvious automations; batch **mute proposals** (“GitHub pings (23) — mute?”).
3. **Bulk clear** — after consent, **`inbox_rules`** + **`archive_emails`** where appropriate; refetch.
4. **Remaining queue** — priority pass (deadlines, people, legal/money); per thread: summarize, **`draft_email`**, or archive; **`send_draft`** only after explicit confirmation, then archive.

Wrap with a one-line reassurance: archived mail stays **findable via `search_index`**.

---

## Deeper reference

Rule grammar, ordering, thread scope, and CLI maintenance notes:  
`ripmail/skills/ripmail/references/INBOX-CUSTOMIZATION.md` in the monorepo.
