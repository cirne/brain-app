# OPP-010: User Skills (slash commands)

## Problem

Today the assistant is driven by a single, monolithic system prompt (`buildBaseSystemPrompt` in [`src/server/agent/index.ts`](../../src/server/agent/index.ts)) plus a fixed tool set. Recurring, well-defined workflows — "create a new wiki page the right way", "lint this page for DRY / link hygiene", "research a topic deeply", "prune obsolete content", "draft an email" — are either:

1. Re-explained in every session by the user, or
2. Stuffed into the base prompt (where they bloat every turn and aren't discoverable).

Users want something closer to Slack: **type `/` and pick a pre-baked recipe**. The recipe carries the instructions, the ordering of tool calls, and the quality bar. The user supplies the topic.

This is not "coding skills" in the Claude Code / developer sense — our users aren't shipping software. They're managing a personal wiki, email, and life context. But the *mechanism* (a named markdown file that teaches the agent how to do a multi-step job well) is the same, and the ecosystem has already converged on a format we should reuse.

## Proposal

### 1. Reuse the `SKILL.md` convention

Anthropic (Claude Code), Cursor, and OpenClaw all use the same on-disk shape: a directory per skill, containing a `SKILL.md` with YAML frontmatter and optional `references/` files loaded lazily. We already consume skills in this format — the repo's own [AGENTS.md](../../AGENTS.md) is used that way, and the user's `~/.claude/skills/ripmail/SKILL.md` is a working example of progressive disclosure (top-level SKILL.md + `references/AUTH-CODES.md`, `references/DRAFT-AND-SEND.md`, etc.).

Using the same format means:

- Zero new authoring standard to learn.
- Skills written for other agents largely drop in (and vice-versa).
- Existing editor tooling (TipTap, our wiki browser) just works — a skill is a markdown file.

Minimum frontmatter we commit to reading:

```yaml
---
name: research           # required; maps to slash command slug (/research)
label: Deep research     # optional; friendly label for the menu
description: >-          # required; shown in autocomplete, fed to the model
  Run a thorough investigation across the wiki, email, web, and YouTube, then
  write a single well-linked wiki page. Takes a topic as input.
args: topic              # optional; free-form hint shown as "/research <topic>"
---
```

The body is plain markdown instructions for the agent — "when to use", "process", "quality bar", "output format", cross-references to other wiki pages / skills. No executable code in v1.

### 2. Where skills live

Sibling of the wiki, inside the same `WIKI_DIR` repo:

```
<WIKI_DIR>/                 # e.g. ~/brain
├── wiki/                   # existing markdown wiki
│   ├── me.md
│   ├── people/
│   └── …
└── skills/                 # NEW — user-authored + overrides
    ├── newfile/
    │   └── SKILL.md
    ├── research/
    │   ├── SKILL.md
    │   └── references/
    │       └── source-priority.md
    └── …
```

Rationale:

- **Git-versioned for free** — the wiki is already synced (debounced commits); skills ride the same bus. History, blame, and rollback work out of the box.
- **Backup & portability parity** with the wiki.
- **Mental model** — "my brain is wiki + skills". Users already think of it as one box.
- **Discoverability** — can be browsed and edited in the wiki UI with no new storage layer.

`wikiDir()` already handles `repoDir()/wiki` vs `repoDir()` flat layouts (see [`src/server/lib/wikiDir.ts`](../../src/server/lib/wikiDir.ts)); skills follow the same pattern with a new `skillsDir()` helper.

**Skill resolution order** (first match wins):

1. `<WIKI_DIR>/skills/<name>/SKILL.md` — user overrides
2. Built-in skills shipped with the app (e.g. `src/server/skills/<name>/SKILL.md`, copied into `dist/`)

This lets us ship a curated set of defaults while keeping every one of them user-editable.

### 3. Invocation UX — slash menu in the chat input

The existing [`AgentInput.svelte`](../../src/client/lib/AgentInput.svelte) already implements an `@`-mention dropdown for wiki files. A sibling `/`-menu is a straight port:

- `/` at the start of the textarea (or after a newline) opens a dropdown listing available skills by `label` + `description`.
- Fuzzy filter as the user types (`fuse.js` or simple substring — we already do substring for mentions).
- Selecting inserts `/<name> ` and leaves the cursor after the space; the rest is the skill's argument.
- `Enter` sends the message as usual. The `/name args…` is preserved in the transcript, so sessions replay correctly.

No changes to the transcript / message schema — a slash command is just the first token of a normal user message.

### 4. Hooking into the assistant (server-side expansion)

When a user message begins with `/<name>`, [`src/server/routes/chat.ts`](../../src/server/routes/chat.ts) resolves and expands before handing off to `getOrCreateSession` / `streamAgentSseResponse`:

1. Parse `/<name>` and the remainder (args).
2. Load `<name>/SKILL.md`; fail closed with a friendly "unknown skill" assistant message if missing.
3. Inject the SKILL.md body as a **per-turn** system message (not a permanent session-level prompt mutation) — so switching skills mid-conversation works, and unused skills don't bloat context.
4. Rewrite the user message to the remainder (args), or, if the skill declares no args, pass an empty user turn with the skill as the single instruction.
5. Optionally resolve `{{selection}}` / `{{open_file}}` placeholders in the skill body from the chat's current context (e.g. the wiki file pane the user has open — we already pass `context` into the chat route).

This keeps the LLM loop simple: no new tool round-trip for discovery, no change to streaming. Skills are invisible to the agent runtime — they're just prompt fragments.

**Why not a tool?** A `use_skill(name)` tool is tempting but adds an extra LLM turn ("decide to call use_skill" → "read it" → "now do the thing") and fails the slash-command UX bar (users expect instant behavior change, not a tool-call preamble). We can still expose `list_skills` / `load_skill` tools later for *natural-language* invocation ("do deep research on X" → agent loads the `research` skill on its own). That's a follow-on, not v1.

### 5. First set of built-in skills

Not married to names — the user explicitly called out that `lint` is too developer-centric. Proposed rename pass (slug in parens is the slash command):

| Today's working name | Proposed slug | Friendly label | Purpose (condensed) |
| -------------------- | ------------- | -------------- | ------------------- |
| `/newfile`           | `/new`        | New wiki page | Search wiki + email + web + YT for existing material, choose the right location, write the page with proper links and no duplication. |
| `/lint`              | `/tidy`       | Tidy a page   | Check DRY, link hygiene, file length, orphan status, stale facts; propose edits (don't auto-apply). |
| `/research`          | `/research`   | Deep research | Multi-source investigation (wiki + email + web + YT), optionally fan out parallel sub-agents, write a single well-linked page. |
| `/prune`             | `/prune`      | Prune         | Find obsolete/duplicate/orphan pages in a subtree; propose moves, merges, and deletions for user review. |
| `/draft`             | `/draft`      | Draft email   | Gather context (thread, people pages, recent calendar), draft in the user's voice, stop for review before `send_draft`. |

All authored as plain markdown; all user-editable on disk. The app ships them as a starting point, not a walled garden.

### 6. npm packages to consider

Deliberately minimal — skills are just markdown files.

- **[`gray-matter`](https://www.npmjs.com/package/gray-matter)** — parse YAML frontmatter. Tiny, zero-dep-at-runtime, universal choice for this format. Already battle-tested with `SKILL.md`-style files.
- **[`fuse.js`](https://www.npmjs.com/package/fuse.js)** *(optional)* — fuzzy match for the slash menu. Current `@`-mention filter is plain substring; if we want the same here for v1, skip Fuse and add later.
- **[`chokidar`](https://www.npmjs.com/package/chokidar)** *(optional, dev-mode only)* — hot-reload skills on edit so authors iterate without restarting the server. Nice-to-have.
- **No runtime dependency** on Claude Code, Cursor, or OpenClaw — we read a public file format; we don't embed their runtimes.

TipTap (already in the repo) handles in-app editing of the SKILL.md files; no new editor needed.

## Non-goals (v1)

- **Executable skills** (Python/JS code blocks run by the agent). Instructional markdown only. Adding code runners is a large separate opportunity with real security and sandboxing cost.
- **Agentic tool authorship.** Skills can *instruct* the agent to use existing tools; they cannot *define* new tools.
- **Parameter schemas / typed args.** Args are a free-form string. If a skill needs structured input, it prompts for it conversationally.
- **Skill marketplace / sharing UI.** Skills are files in a git repo — sharing is `git` today. A marketplace is downstream of agent-to-agent work ([OPP-001](./OPP-001-agent-to-agent.md)).
- **Per-skill tool allow/deny lists.** Possible later; v1 inherits the session's full tool set.

## Open questions

- **Argument conventions.** Is it always "one free-form string tail" (like Slack), or do we also accept `/draft to:alice@x.com re:<topic>` flag-ish syntax? Recommendation: v1 is tail-string only; flags are a footgun for non-developers.
- **Default-skill elevation.** Should a few skills (e.g. `/new`) also be invoked automatically when the user says "make a new page about X" without the slash? Handle via the optional `list_skills` / `load_skill` tools in a follow-up, not by auto-injection.
- **Scope of built-ins.** Ship 3–5 curated defaults, or none (power-user-authors-their-own)? Recommendation: ship the five above because they demonstrate range and each is individually useful on day one.
- **Onboarding.** Should the onboarding agent ([OPP-006](./OPP-006-email-bootstrap-onboarding.md)) seed `skills/` with user-flavored variants of the defaults (e.g. `/draft` pre-tuned to the user's voice from their sent-mail)? Probably yes, but out of this OPP's scope.

## Migration / rollout

1. Add `skillsDir()` alongside `wikiDir()`; scaffold an empty `skills/` directory on first run.
2. Ship built-in skill files under `src/server/skills/` copied into `dist/` at build.
3. Add `SkillRegistry` service (discover, parse, cache; watch for changes in dev).
4. Wire slash parsing into `chat.ts` POST handler with per-turn system-prompt injection.
5. Add `/`-menu to `AgentInput.svelte`, mirroring the existing `@`-mention code path.
6. Expose a minimal `GET /api/skills` for the menu to hydrate from.
7. Tests: registry parsing, slash parsing, per-turn prompt composition, precedence (user overrides built-in), "unknown skill" handling.

## Related

- [OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md) — `/tidy` and `/prune` are natural hosts for the lint/changelog work proposed there.
- [OPP-006: Email-Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md) — onboarding can personalize built-in skills (especially `/draft`).
- [OPP-001: Agent-to-Agent Communication](./OPP-001-agent-to-agent.md) — future: share skills between brains.

## Success criteria

- Typing `/` in chat opens a menu within ~50ms of keystroke; five default skills are listed with `label` + `description`.
- User can edit `<WIKI_DIR>/skills/research/SKILL.md`, re-run `/research`, and see the new behavior take effect with no server restart (dev) / one restart (prod).
- A `SKILL.md` written for Claude Code drops into `<WIKI_DIR>/skills/` and runs with no modification.
- Zero increase in base system-prompt token count when no skill is invoked (skills load per-turn only).
