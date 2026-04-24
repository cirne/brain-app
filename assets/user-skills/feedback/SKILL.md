---
name: feedback
label: "Feedback: bugs and feature requests (local, confirm before save)"
description: >-
  Collect bugs or product ideas, draft a redacted report with the product_feedback tool, show the
  user the full draft, and only call submit after they clearly confirm. Data stays under
  $BRAIN_HOME/issues on this machine; use GET /api/issues with the embed key for triage in agents.
hint: what went wrong or what you want
args: Optional details in natural language; no required parameters.
---

# Feedback

Use the **`product_feedback`** tool to capture **structured feedback** (bug or feature) into local files. User-facing copy says **feedback**; on disk these are **issues** under `issues/` in your brain home.

## When to use

The user wants to **report a problem**, request a **new capability**, or send **product feedback** to improve Brain — not to edit wiki content or mail (use `/wiki` or `/email` for those).

## Process

1. **Understand** — Briefly restate what they care about. Ask one clarifying question only if repro or scope is truly unclear.
2. **Draft** — Call `product_feedback` with `op: "draft"`, a clear `user_message`, and optional `transcript` (recent relevant chat) or `tool_hints` (short error text).
3. **Show the draft** — Paste or summarize the returned markdown. Say that **PII redaction is best-effort** and they should not paste secrets into follow-ups.
4. **Confirm** — Only if they **explicitly** ask to save (e.g. “yes, file it”, “submit that”): call `product_feedback` with `op: "submit"`, the **same** `markdown` as the draft, and `confirmed: true`. If they want edits, adjust the markdown together and only submit with `confirmed: true` after approval.
5. **Never** call submit without that explicit consent.

## Triage (maintainers and agents)

- **List / read** issues: `GET /api/issues` and `GET /api/issues/:id` with `Authorization: Bearer` set to `BRAIN_EMBED_MASTER_KEY` (single-tenant; loopback / trusted operator only).
- **npm** (when configured): `npm run issues:list` and `npm run issues:fetch -- <id>`.
- Outcomes in this repo: promote into `docs/bugs/` or fix in code; there is no cloud queue in v1.
