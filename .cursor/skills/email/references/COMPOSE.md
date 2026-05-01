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

- **`action=new`** — requires **`to`** + **`instruction`** (LLM drafts subject + body).
- **`action=reply`** — requires **`message_id`** + **`instruction`**.
- **`action=forward`** — requires **`message_id`**, **`to`**, and **`instruction`**.
- **`from`** — optional; when multiple mailboxes exist, pass the sender email or ripmail **source id** the user names (e.g. “from work”).

Do not repeat the generated body in your next turn; the UI already shows it.

---

## Phase 3 — **`edit_draft`**

Use **`draft_id`** plus:

- **`instruction`** — LLM revises body/tone (and related fields per tool semantics).
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
