---
name: email
label: "Read, search, draft, and fix how mail surfaces in your inbox"
description: >-
  Single skill for inbox and mail: search/read threads; triage including batch “mute noisy stuff” flows;
  draft replies or new mail with context from threads, wiki people pages, or calendar when relevant;
  investigate why an expected message did not appear (often an aggressive filter—“filters,” not jargon).
  Prefer built-in Brain tools (`search_index`, `read_mail_message`, `read_indexed_file`, `list_inbox`, `inbox_rules`, `draft_email`, etc.);
  assume no raw ripmail shell. Never send mail without explicit user confirmation.
hint: >-
  what's in my inbox, find that email, why didn't X show up, mute these newsletters,
  draft a reply, clear my inbox, fix filters hiding mail
args: >-
  Optional natural language: who, thread, mailbox, timeframe, tone, or what seemed missing from the inbox.
---

# Email (Braintunnel)

Unified mail workflows — **finding**, **surfacing**, **composing**, and **investigating misses**. Users often **won’t run slash commands**; this skill loads from normal language (`description` + `hint` above).

## When to use

The user wants help with **connected email**, not standalone wiki authoring or arbitrary web answers (use **research** / **wiki** for those).

## Process

1. **Clarify** when needed — which account (`from` / source), approximate date, sender, or topic.
2. **Fresh index** — when “right now” matters, **`refresh_sources`** first (or note background sync and short wait).
3. **Retrieve** — **`search_index`** to find IDs; **`read_mail_message`** / **`read_indexed_file`** / **`read_attachment`** to open (mail vs indexed file vs MIME part); **`list_inbox`** for inbox-shaped summaries; **`find_person`** for contact questions.
4. **Act** — summarize, mute/archive patterns (**see [references/INBOX.md](references/INBOX.md)**), tighten filters (**same doc** — user-facing wording: filters, not infrastructure).
5. **Draft** — **`draft_email`** / **`edit_draft`**; respect tone from **`me.md`** and sent mail context when inferable (**[references/COMPOSE.md](references/COMPOSE.md)**).
6. **Send** — only **`send_draft`** after **explicit** confirmation; see compose doc.
7. **After a confirmed reply/send** — archive the handled thread (**`archive_emails`**) unless the user opts out — one less open loop.
8. **After summarizing inbox** — almost always suggest **Archive** (**`archive_emails`**) for what they meant to notice (**`inform`/`notify`**): skimmed receipts, pings, FYIs they’re done with. Don’t prioritize “archive every promo row” when those are already **ignored** buckets; chips like **Archive the receipt / FYI thread** usually match intent better (**[references/INBOX.md](references/INBOX.md)**).

### Missing from inbox?

Follow [references/INBOX.md](references/INBOX.md) **Reactive path**. Key tool: **`list_inbox`** with **`thorough: true`** so hidden/decision metadata (e.g. which filter matched) is visible to the assistant.

### Deep playbooks

- **Compose loop** → [references/COMPOSE.md](references/COMPOSE.md)
- **Inbox rhythm, filters, misses, noisy-mail clearing** → [references/INBOX.md](references/INBOX.md)

## Related

- **morning_report** — day-at-a-glance with **light** inbox (at most a few bullets) unless user wants deeper mail work (then stay in **email**).
- **briefing** — meeting prep; mail only as supporting context unless they pivot into clearing (**email**).
