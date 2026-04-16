---
name: email
label: "Email: read, triage, draft, rules — confirm before send"
description: >-
  Single entry for inbox and mail workflows: summarize or search threads, read messages, triage,
  apply or explain inbox rules, draft new mail or replies with context from threads, wiki people
  pages, and calendar when relevant. Examples: “what’s unread in work inbox”; “draft a reply to the
  budget thread”; “archive these after I confirm”. Never send without explicit user confirmation.
hint: what to do with mail—say it plainly
args: >-
  Optional natural language: who, which thread, intent, tone. No required positional parameters.
version: 1
---

# Email

Use ripmail-backed tools for **read**, **search**, **inbox**, **draft**, and **rules**. **Send** and other irreversible actions stay **confirm-gated** in the skill text regardless of how the user invoked `/email`.

## When to use

The user wants help with **email**—not wiki pages, not web research. If the task is “write something for the wiki,” use `/wiki` or `/research` instead.

## Process

1. **Clarify (if needed)** — If the ask is ambiguous (which account, which thread), narrow it with one question or reasonable defaults from context.
2. **Context** — Use inbox, read, search, thread tools as needed. Pull in wiki people pages and calendar when they improve recipients, tone, or scheduling. If `{{open_file}}` is present, treat it as relevant background.
3. **Act** — Summarize, find, triage, adjust drafts, explain rules—whatever matches the user’s goal.
4. **Draft** — Match tone from `me.md` and past sent mail when available via tools. Present drafts clearly.
5. **Send** — Do **not** call send tools until the user **explicitly confirms** sending (and to whom). Same for destructive bulk actions.

## Quality bar

- Correct recipients and subject when inferable from thread.
- No fabricated facts; mark assumptions.
- Safe by default: no surprise sends or mass deletes.
