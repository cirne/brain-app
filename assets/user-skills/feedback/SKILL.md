---
name: feedback
label: "File a bug report or feature request for the team"
description: >-
  Collect bugs or product ideas, draft with product_feedback including enough context to reproduce
  (user prompt plus tool/trace summary when agent behavior matters), strip secrets-only, show the draft,
  submit only after clear confirm. Saves wiki/feedback/issue-<n>.md on submit.
hint: what went wrong or what you want
args: Optional details in natural language; no required parameters.
---

# Feedback

Use the `**product_feedback**` tool to capture **structured feedback** (bug or feature). User-facing copy says **feedback**; the product records the report and also saves a copy in **your vault wiki** at **`wiki/feedback/issue-<id>.md`** (under the wiki content root) so the user can open it in the library or you can `**read**` that path if they want to see what was filed. Use the **`/wiki`** skill if they need help browsing the vault wiki.

## When to use

The user wants to **report a problem**, request a **new capability**, or send **product feedback** to improve Brain — not to edit other wiki content or mail (use `/wiki` or `/email` for those).

## Process

1. **Understand** — Briefly restate what they care about. Ask one clarifying question only if repro or scope is truly unclear.
2. **Draft** — Call `product_feedback` with `op: "draft"`, a clear `user_message`, and **concrete agent context when useful**:
   - Pass `transcript` with enough **recent turns** that the drafted issue can show **what the user asked** and, for agent bugs, a **concise chronological list of tool calls** (name + args summary + outcome or error)—so issues like “it never searched the wiki” remain diagnosable.
   - Pass `tool_hints` for isolated errors or stack snippets (still keep secrets out).
   - Do **not** omit tool traces to “protect privacy” beyond replacing secrets and obvious PII; the server draft step redacts credentials and stray identifiers while **keeping** reproducibility details.
3. **Show the draft** — Paste or summarize the returned markdown. Say they should **review** before save: drafts aim to strip **secrets** and unnecessary personal identifiers, not wipe debugging context they intended to share. Remind them not to paste passwords or recovery codes.
4. **Confirm** — Only if they **explicitly** ask to save (e.g. “yes, file it”, “submit that”): call `product_feedback` with `op: "submit"`, the **same** `markdown` as the draft, and `confirmed: true`. If they want edits, adjust the markdown together and only submit with `confirmed: true` after approval.
5. **Never** call submit without that explicit consent.
