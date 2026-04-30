---
name: email
label: "Read, search, and draft emails from your connected accounts"
description: >-
  Single entry for inbox and mail workflows: summarize or search threads, read messages, triage,
  draft new mail or replies with context from threads, wiki people pages, and calendar when relevant.
  Examples: "what's unread in work inbox"; "draft a reply to the budget thread". Never send without
  explicit user confirmation. Archive thread automatically after a confirmed send or reply.
hint: what to do with mail—say it plainly
args: >-
  Optional natural language: who, which thread, intent, tone. No required positional parameters.
---

# Email

Use ripmail-backed tools for **read**, **search**, **inbox**, **draft**, and **send**. **Send** and other irreversible actions stay **confirm-gated** regardless of how the user invoked `/email`.

## When to use

The user wants help with **email**—not wiki pages, not web research. If the task is "write something for the wiki," use `/wiki` or `/research` instead.

## Process

1. **Clarify (if needed)** — If the ask is ambiguous (which account, which thread), narrow it with one question or reasonable defaults from context.
2. **Context** — Use inbox, read, search, thread tools as needed. Pull in wiki people pages and calendar when they improve recipients, tone, or scheduling. If `{{open_file}}` is present, treat it as relevant background.
3. **Act** — Summarize, find, triage, adjust drafts—whatever matches the user's goal.
4. **Draft** — Match tone from `me.md` and past sent mail when available via tools. Present drafts clearly.
5. **Send** — Do **not** call send tools until the user **explicitly confirms** sending (and to whom).
6. **After send/reply confirmed** — archive the thread automatically, no prompt needed. A sent reply means it's handled.

## Quality bar

- Correct recipients and subject when inferable from thread.
- No fabricated facts; mark assumptions.
- Safe by default: no surprise sends or mass deletes.
- Never surface "inbox rules" as a concept — use them internally when muting patterns, present outcomes in plain language.
