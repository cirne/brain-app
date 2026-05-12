# Compose and send (Brain tools)

Companion to the [email](../SKILL.md) skill. Describes how the agent **creates, revises, and sends** mail using **Brain tools** backed by ripmail. The user sees drafts in the app; **do not paste full bodies** in chat unless they ask.

---

## Mental model

| Concept | In the app |
| --- | --- |
| **Draft** | Created on disk by ripmail; user preview / editor in Brain. |
| **`draft_id`** | Use the id returned by **`draft_email`** / **`edit_draft`** with **`send_draft`**. |
| **Send** | **`send_draft`** only **after** the user has seen the draft and confirmed. |

For SMTP / provider details and product rationale see **ADR-024** in repo `docs/ARCHITECTURE.md`.

---

## Phase 1 — Context before drafting

| Goal | Tool |
| --- | --- |
| Find the message to reply to / forward | **`search_index`** → note **`messageId`** |
| Read for tone and facts | **`read_mail_message`** (or **`read_indexed_file`** for indexed non-mail files), or search again for thread context |
| Person / address hints | **`find_person`** |

Prefer knowing **which `messageId`** applies before **`draft_email`** with `action=reply` or `forward`.

---

## Phase 2 — **`draft_email`**

- **`action=new`** — requires **`to`**, **`subject`**, and **`body`** (final outbound text; there is no server-side compose step).
- **`action=reply`** — requires **`message_id`** and **`body`**; **`subject`** optional (defaults to `Re:` the threaded subject). Default behavior is reply-all recipients from the source message; set `reply_all: false` when the user explicitly wants sender-only.
- **`action=forward`** — requires **`message_id`**, **`to`**, and **`body`**; **`subject`** optional (defaults to `Fwd:` the threaded subject).
- For reply/forward, **`message_id`** must be the exact **`messageId`** from **`list_inbox`**, **`search_index`**, or **`read_mail_message`**. If you are unsure which message the user means, re-search or read it first; drafts fail when the source message is not indexed.
- **`from`** — optional; when multiple mailboxes exist, pass the sender email or ripmail **source id** the user names (e.g. “from work”).
- If the user names a person but not an address, run **`find_person`** first and use the best matched email from contacts/wiki context rather than guessing.
- **`b2b_query: true`** — Braintunnel collaborator mail; the server normalizes **`subject`** so the `[braintunnel]` marker appears after any `Re:` / `Fwd:` chain. **`grant_id`** is opaque routing context — do not put it in **`body`** unless the user asks.

Do not repeat the generated body in your next turn; the UI already shows it.

---

## Phase 3 — **`edit_draft`**

Use **`draft_id`** plus:

- **`body`** — replaces the entire draft body with final text when revising content.
- Or structured fields — **`subject`**, **`to`/`cc`/`bcc`**, **`add_*` / `remove_*`** for recipients.

Again: **no full-body paste** in chat unless requested.

---

## Phase 4 — **`send_draft`**

Only after explicit user confirmation:

```text
send_draft({ draft_id: "<id>" })
```

Eval / dry-run environments may use **`RIPMAIL_SEND_TEST`** semantics server-side — treat tool output as source of truth.

---

## Safety

- **Confirm send** — never **`send_draft`** on implied consent alone.
- **Recipients** — double-check **`to`/`cc`** after **`edit_draft`** if the user is sensitive about visibility.

---

## Deeper ripmail CLI reference

For flag-level detail and one-shot `ripmail send --to …` patterns, see the upstream doc (conceptually identical, different surface):  
`ripmail/skills/ripmail/references/DRAFT-AND-SEND.md` in the brain-app monorepo.
