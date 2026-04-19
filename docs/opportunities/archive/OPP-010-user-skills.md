# Archived: OPP-010 (User Skills / Slash Commands)

**Status: Deprioritized — archived.** The slash-command skill system is a well-designed feature but not essential right now. The main agent with a strong system prompt and CLAUDE.md guidance handles the core workflows (wiki, email, research) without requiring a dedicated skill-invocation layer. The assets directory (`assets/user-skills/`) does not exist yet. Archived to reduce active queue; reopen as a fresh OPP when slash discovery or workflow repeatability becomes a real friction point.

**What was deferred:**
- `/`-menu in chat input backed by `SKILL.md` files
- `assets/user-skills/` shipped defaults (`/wiki`, `/research`, `/email`)
- `<WIKI_DIR>/skills/` seeding and user-editable overrides
- Per-turn system-prompt injection for selected skills
- `GET /api/skills` endpoint

**Why deprioritized:**
- The main agent already handles "new page", "tidy this", "search email", and "research topic" naturally via NL
- Adding a skill layer before product-market fit risks over-engineering the chat UX
- A small set of curated built-in SKILL.md files can be added cheaply when the time is right

**If reopened:** The design in this doc is thorough and ready to implement. Start with the seeder + slash parser; the UI dropdown mirrors the existing `@`-mention code path.

---

# OPP-010: User Skills (slash commands)

## Problem

Today the assistant is driven by a single, monolithic system prompt (`buildBaseSystemPrompt` in `[src/server/agent/index.ts](../../src/server/agent/index.ts)`) plus a fixed tool set. Recurring, well-defined workflows — "create a new wiki page the right way", "lint this page for DRY / link hygiene", "research a topic deeply", "prune obsolete content", "draft an email" — are either:

1. Re-explained in every session by the user, or
2. Stuffed into the base prompt (where they bloat every turn and aren't discoverable).

Users want something closer to Slack: **type `/` and pick a pre-baked recipe**. The recipe carries the instructions, the ordering of tool calls, and the quality bar. The user supplies the topic.

## Proposal

### 1. Reuse the `SKILL.md` convention

Minimum frontmatter:

```yaml
---
name: email
label: Email
description: >-
  Read, triage, draft; confirm before send. Natural language after the slash.
hint: what to do with mail
version: 1
---
```

### 2. Where skills live — two locations

**A. At runtime:** `<WIKI_DIR>/skills/` — user-editable, git-versioned, seeded from app defaults.

**B. In this repo:** `assets/user-skills/` — shipped defaults (`wiki`, `research`, `email`).

### 3. Invocation UX — slash menu in the chat input

`/` at start of textarea opens a dropdown; selecting inserts `/<name>` and the rest is the skill's argument. No changes to message schema.

### 4. Server-side expansion

When a user message begins with `/<name>`, the chat route:
1. Parses `/<name>` and remainder
2. Loads `<name>/SKILL.md`
3. Injects skill body as a **per-turn** system message (not permanent)
4. Rewrites user message to remainder

### 5. Seeding defaults

At server boot, `ensureDefaultSkillsSeeded()` copies missing bundled skills to `<WIKI_DIR>/skills/`. Respects user edits (never overwrites) and user deletions (tracks in `.seeded.json`).

### 6. First set of built-in skills

| Slug | Purpose |
| --- | --- |
| `/wiki` | Umbrella: new page, tidy, prune, link repair — NL specifies the job |
| `/research` | Multi-source investigation → durable wiki page(s) |
| `/email` | Inbox, read, triage, draft; confirm before send |

## Non-goals (v1)

- Executable skills (Python/JS code blocks)
- Agentic tool authorship
- Parameter schemas / typed args
- Skill marketplace / sharing UI

## Related

- [OPP-011: User skills strategy](./OPP-011-user-skills-strategy.md)
- [OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md)
- [OPP-006: Email-Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md)
