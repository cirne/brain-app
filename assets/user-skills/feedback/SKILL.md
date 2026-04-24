---
name: feedback
label: "Submit a bug or feature request"
description: >-
  Collect bugs or product ideas, draft a redacted report with the product_feedback tool, show the
  user the full draft, and only call submit after they clearly confirm. After submit, a copy is
  also saved in their wiki as wiki/feedback/issue-<n>.md for their reference.
hint: what went wrong or what you want
args: Optional details in natural language; no required parameters.
---

# Feedback

Use the `**product_feedback**` tool to capture **structured feedback** (bug or feature). User-facing copy says **feedback**; the product records the report and also saves a copy in **your vault wiki** at **`wiki/feedback/issue-<id>.md`** (under the wiki content root) so the user can open it in the library or you can `**read**` that path if they want to see what was filed. Use the **`/wiki`** skill if they need help browsing the vault wiki.

## When to use

The user wants to **report a problem**, request a **new capability**, or send **product feedback** to improve Brain — not to edit other wiki content or mail (use `/wiki` or `/email` for those).

## Process

1. **Understand** — Briefly restate what they care about. Ask one clarifying question only if repro or scope is truly unclear.
2. **Draft** — Call `product_feedback` with `op: "draft"`, a clear `user_message`, and optional `transcript` (recent relevant chat) or `tool_hints` (short error text).
3. **Show the draft** — Paste or summarize the returned markdown. In your own words, tell them the draft is written to avoid including personal details, but they should **review it** before it is saved in case anything sensitive slipped through. Remind them not to put passwords, recovery codes, or other secrets into the report or into further messages about it.
4. **Confirm** — Only if they **explicitly** ask to save (e.g. “yes, file it”, “submit that”): call `product_feedback` with `op: "submit"`, the **same** `markdown` as the draft, and `confirmed: true`. If they want edits, adjust the markdown together and only submit with `confirmed: true` after approval.
5. **Never** call submit without that explicit consent.
