---
name: draft
label: Draft email
description: >-
  Gather context from the inbox thread, people wiki pages, and calendar when relevant.
  Draft a reply in the user's voice. Stop for review before any send action.
hint: draft a new email
args: <to> — <what>
version: 1
---

# Draft email

## When to use

The user wants help **writing or replying to email** with full context from tools.

## Process

1. **Context** — Use inbox/read/search and wiki people pages as needed. If `{{open_file}}` is present, treat it as relevant background.
2. **Draft** — Produce a concise draft matching tone from `me.md` and past sent mail if available via tools.
3. **Review** — Present the draft clearly. Do **not** call send tools until the user confirms.

## Quality bar

- Correct recipients and subject when inferable from thread.
- No fabricated facts; mark assumptions.
