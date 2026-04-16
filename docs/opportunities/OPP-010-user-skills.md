# OPP-010: User Skills (slash commands)

## Problem

Today the assistant is driven by a single, monolithic system prompt (`buildBaseSystemPrompt` in `[src/server/agent/index.ts](../../src/server/agent/index.ts)`) plus a fixed tool set. Recurring, well-defined workflows — "create a new wiki page the right way", "lint this page for DRY / link hygiene", "research a topic deeply", "prune obsolete content", "draft an email" — are either:

1. Re-explained in every session by the user, or
2. Stuffed into the base prompt (where they bloat every turn and aren't discoverable).

Users want something closer to Slack: **type `/` and pick a pre-baked recipe**. The recipe carries the instructions, the ordering of tool calls, and the quality bar. The user supplies the topic.

This is not "coding skills" in the Claude Code / developer sense — our users aren't shipping software. They're managing a personal wiki, email, and life context. But the *mechanism* (a named markdown file that teaches the agent how to do a multi-step job well) is the same, and the ecosystem has already converged on a format we should reuse.

## Terminology — "developer skills" vs "user skills"

The word "skill" already appears in this repo in a **developer** context and must not be conflated with the **user** feature proposed here. Two disjoint populations, two disjoint locations:


| Audience                        | Purpose                                                                       | Location                                                                        | Authored by                             |
| ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| **Developer skills** (existing) | Instruct coding agents (Cursor, Claude Code) that are working *on brain-app*. | `~/.cursor/skills*/`, `~/.claude/skills/`, repo `AGENTS.md` / `CLAUDE.md`       | Us, for ourselves                       |
| **User skills** (this OPP)      | Recipes the end-user invokes from chat via `/slash`.                          | `<WIKI_DIR>/skills/` at runtime, shipped from `assets/user-skills/` in the repo | Anyone running the app (us + end-users) |


Throughout this OPP, **"skill"** refers exclusively to a **user skill** unless stated otherwise. Built-ins live in a directory named `user-skills/` — not `skills/` — precisely so that `rg skills`, file-tree browsing, and tab-completion never mix the two concepts.

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
name: draft              # required; maps to slash command slug (/draft)
label: Draft email       # optional; friendly label for the menu row
description: >-          # required; fed to the model for relevance + used for
  Gather context (thread, people pages, recent calendar) and draft an email
  in the user's voice. Stops for user review before send.
hint: draft a new email  # short UI-only help text shown beside the cursor
args: <to> — <what>      # optional; usage template for placeholder tokens
version: 1               # defaults only — drives the seeder (see §5)
---
```

The body is plain markdown instructions for the agent — "when to use", "process", "quality bar", "output format", cross-references to other wiki pages / skills. No executable code in v1.

**Why a separate `hint` field instead of reusing `description`?** The SKILL.md standard does not have a dedicated UI-hint field — `description` is the only thing close. But `description` is *model-facing* by convention (e.g. the 11-line `description:` block in `[~/.claude/skills/ripmail/SKILL.md](/Users/cirne/.claude/skills/ripmail/SKILL.md)`): long, keyword-dense, tuned for the agent's relevance decision. That's poor material for ghost text next to a cursor.

Instead we add two small UI-only fields, both optional and both back-compat with any existing SKILL.md:

- `**hint`** — a short human phrase (rule of thumb: ≤ 40 characters). Rendered as faint ghost text immediately after the slug when the user selects the skill from the menu. Disappears on the first keystroke of args.
- `**args`** — a usage template (e.g. `<topic>`, `<to> — <what>`). Rendered with a distinct "placeholder token" style; also clears on first keystroke.

Fallback cascade for the ghost text, if the author didn't set `hint`:

1. `hint` (if present)
2. First sentence of `description`, truncated at ~60 chars
3. Nothing — just a blank placeholder

So the Slack-style UX works out of the box:

- Menu row: `**/draft**` — `Draft email` · *draft a new email*
- After selection, cursor sits at `/draft |` with ghost text `<to> — <what>` (or `draft a new email` if `args` is empty)
- First character the user types replaces the ghost text

None of this breaks skills authored for Claude Code / Cursor that omit both fields — they just fall back to description-derived ghost text or a blank placeholder.

### 2. Where skills live — two locations

**A. At runtime (user-facing, editable, git-versioned):** sibling of the wiki, inside the same `WIKI_DIR` repo:

```
<WIKI_DIR>/                 # e.g. ~/brain, ~/Documents/Brain on macOS bundle
├── wiki/                   # existing markdown wiki
│   ├── me.md
│   ├── people/
│   └── …
└── skills/                 # NEW — user-authored + seeded defaults
    ├── new/
    │   └── SKILL.md
    ├── research/
    │   ├── SKILL.md
    │   └── references/
    │       └── source-priority.md
    ├── …
    └── .seeded.json        # tracks which default skills + versions have been seeded
```

Rationale for co-locating with the wiki:

- **Git-versioned for free** — the wiki is already synced (debounced commits); skills ride the same bus. History, blame, and rollback work out of the box.
- **Backup & portability parity** with the wiki.
- **Mental model** — "my brain is wiki + skills". Users already think of it as one box.
- **Discoverability** — can be browsed and edited in the wiki UI with no new storage layer.

`wikiDir()` already handles `repoDir()/wiki` vs `repoDir()` flat layouts (see `[src/server/lib/wikiDir.ts](../../src/server/lib/wikiDir.ts)`); skills follow the same pattern with a new `skillsDir()` helper that returns `<repoDir()>/skills`.

**B. In this repo (defaults we ship):** a new top-level `assets/` tree, explicitly named to avoid any collision with developer-facing skill directories:

```
brain-app/
├── assets/
│   └── user-skills/         # shipped with the app; seeded into <WIKI_DIR>/skills/
│       ├── new/
│       │   └── SKILL.md
│       ├── tidy/
│       │   └── SKILL.md
│       ├── research/
│       │   ├── SKILL.md
│       │   └── references/
│       │       └── source-priority.md
│       ├── prune/
│       │   └── SKILL.md
│       └── draft/
│           └── SKILL.md
├── src/
├── .claude/                  # developer skills — unrelated, do not touch
├── .cursor/                  # developer skills — unrelated, do not touch
└── AGENTS.md                 # repo-level dev instructions — unrelated
```

Why `assets/user-skills/` specifically:

- **Cannot be mistaken for developer skills.** There is no `skills/` or `.skills/` anywhere near the top level, and the word `user-skills` signals the audience.
- **Matches how Tauri / bundler conventions treat read-only shipped data** (static data files that the runtime reads, separate from source code). This is also where future bundled assets (templates, sample wiki fragments) should live.
- **Not under `src/`**, because these files aren't compiled — they're copied verbatim. Keeping them out of `src/` means Vitest, ESLint, and `tsc` leave them alone.

**Build wiring:**

- `npm run build` copies `assets/user-skills/` → `dist/server/assets/user-skills/` (small `tsup`/esbuild-style post-step or a tiny script in `[scripts/](../../scripts/)`). Source of truth stays in `assets/`; `dist/` is rebuilt.
- Tauri: the existing `tauri:bundle-server` step already copies `dist/` into `desktop/resources/server-bundle/`, so the bundled Brain.app picks these up with zero extra config.

**Skill resolution order** at lookup time (first match wins):

1. `<WIKI_DIR>/skills/<name>/SKILL.md` — whatever the user has locally (their overrides, their own authored skills, or seeded defaults they haven't deleted).
2. *(No second tier in the hot path.)* The shipped copy in `assets/user-skills/` is only consulted by the seeder described below, never directly at chat time. This keeps the runtime simple: the user's filesystem is the single source of truth for which skills exist right now.

### 3. Invocation UX — slash menu in the chat input

The existing `[AgentInput.svelte](../../src/client/lib/AgentInput.svelte)` already implements an `@`-mention dropdown for wiki files. A sibling `/`-menu is a straight port:

- `/` at the start of the textarea (or after a newline) opens a dropdown listing available skills by `label` + `description`.
- Fuzzy filter as the user types (`fuse.js` or simple substring — we already do substring for mentions).
- Selecting inserts `/<name>`  and leaves the cursor after the space; the rest is the skill's argument.
- `Enter` sends the message as usual. The `/name args…` is preserved in the transcript, so sessions replay correctly.

No changes to the transcript / message schema — a slash command is just the first token of a normal user message.

### 4. Hooking into the assistant (server-side expansion)

When a user message begins with `/<name>`, `[src/server/routes/chat.ts](../../src/server/routes/chat.ts)` resolves and expands before handing off to `getOrCreateSession` / `streamAgentSseResponse`:

1. Parse `/<name>` and the remainder (args).
2. Load `<name>/SKILL.md`; fail closed with a friendly "unknown skill" assistant message if missing.
3. Inject the SKILL.md body as a **per-turn** system message (not a permanent session-level prompt mutation) — so switching skills mid-conversation works, and unused skills don't bloat context.
4. Rewrite the user message to the remainder (args), or, if the skill declares no args, pass an empty user turn with the skill as the single instruction.
5. Optionally resolve `{{selection}}` / `{{open_file}}` placeholders in the skill body from the chat's current context (e.g. the wiki file pane the user has open — we already pass `context` into the chat route).

This keeps the LLM loop simple: no new tool round-trip for discovery, no change to streaming. Skills are invisible to the agent runtime — they're just prompt fragments.

**Why not a tool?** A `use_skill(name)` tool is tempting but adds an extra LLM turn ("decide to call use_skill" → "read it" → "now do the thing") and fails the slash-command UX bar (users expect instant behavior change, not a tool-call preamble). We can still expose `list_skills` / `load_skill` tools later for *natural-language* invocation ("do deep research on X" → agent loads the `research` skill on its own). That's a follow-on, not v1.

### 5. Seeding the defaults into `<WIKI_DIR>/skills/`

The seeder's contract: **on every server boot, make sure every default skill the app shipped this release exists in the user's skills directory — unless the user has already dealt with it.** It must never overwrite user edits, and it must never resurrect a default the user deleted on purpose.

**When it runs.** At server startup, inside `start()` in `[src/server/index.ts](../../src/server/index.ts)`, right after `loadDotEnv()` and before any HTTP listen. Call site:

```ts
// src/server/index.ts
await ensureDefaultSkillsSeeded()   // new; idempotent; cheap on subsequent boots
```

Placing it at boot (not at onboarding) means:

- **Existing installs** get the feature automatically on upgrade (they have a `WIKI_DIR` but never ran onboarding v2).
- **Fresh installs** running through onboarding see the `skills/` directory populate during the same first-launch window as the wiki scaffold, with no extra integration point.
- **Tauri bundle** and **dev `npm run dev`** and **Docker** all hit the same code path. No per-distribution special-casing.

It still plays nicely with onboarding — the onboarding UI just reads `<WIKI_DIR>/skills/` like any other consumer; the files are already there.

**What it does.** Pseudocode:

```ts
// src/server/lib/skillsSeeder.ts
async function ensureDefaultSkillsSeeded() {
  const skillsRoot = skillsDir()                       // <WIKI_DIR>/skills
  await mkdir(skillsRoot, { recursive: true })

  const marker = join(skillsRoot, '.seeded.json')      // { "<slug>": "<version>" }
  const seeded = await readJsonOrEmpty(marker)

  const bundledRoot = bundledUserSkillsDir()           // dist/server/assets/user-skills
  const defaults = await listBundledSkills(bundledRoot) // [{ slug, version, srcDir }]

  for (const { slug, version, srcDir } of defaults) {
    const alreadySeededThisVersion = seeded[slug] === version
    const targetExists = await pathExists(join(skillsRoot, slug))

    // Case A: target is present — never touch. User owns it.
    if (targetExists) { seeded[slug] = version; continue }

    // Case B: we already seeded this exact (slug, version) and the user has since
    // deleted it. Respect that — do not resurrect.
    if (alreadySeededThisVersion) continue

    // Case C: first-ever seed, OR we shipped a new version of a skill the user
    // had deleted the old version of. Copy the bundled tree verbatim.
    await copyDir(srcDir, join(skillsRoot, slug))
    seeded[slug] = version
  }

  await writeJson(marker, seeded)
}
```

Key properties:

- **Non-destructive.** `targetExists` is checked per-slug before any write; we never traverse into an existing skill dir, so user edits, references/, and renames are untouched.
- **Respects deletion.** Once a (slug, version) has been seeded, we record it in `.seeded.json`. If the user deletes it, we don't put it back.
- **Respects new versions.** If we ship `research` v2 and the user had deleted v1, v2 gets seeded once (their delete applied only to the version they deleted). Conservative alternative: *never* re-seed after any prior seeding of that slug — pick one and document it; the code above takes the "new-version opt-in" path.
- **Cheap.** Reads a small JSON file and does `stat`s per slug. Microseconds after the first run.
- **Single source of truth at runtime is the user's disk.** The seeder writes files into `<WIKI_DIR>/skills/` and then walks away; the `SkillRegistry` (§4) reads only from there.

`**SKILL.md` version field.** Add a `version:` to default skills' frontmatter (e.g. `version: 1`). User-authored skills don't need one — they're never compared.

**Edge cases handled:**

- Missing `WIKI_DIR` / unwritable filesystem → log a warning, don't crash the server. Slash commands degrade to "unknown skill" for defaults; user-authored skills still work.
- User renames a seeded skill dir (`research` → `deep-dive`) → the seeder sees `research` is missing, sees `.seeded.json["research"] = "1"`, does not re-seed. Correct behavior.
- User edits a seeded skill in place → we never overwrite it. Correct behavior.
- User wants the latest upstream version → manual: delete their copy, bump the version in `.seeded.json` (or `rm .seeded.json` entirely), restart. A `POST /api/skills/reseed?slug=research` endpoint can wrap this later.

**What `assets/user-skills/` *doesn't* do:** it's never queried at chat time. If we ever decide to support "invisible built-ins that can't be deleted" (strongly discouraged — editability is half the point), that would be a second resolution tier, not this one.

### 6. First set of built-in skills

Not married to names — the user explicitly called out that `lint` is too developer-centric. Proposed rename pass (slug in parens is the slash command):


| Today's working name | Proposed slug | Friendly label | Purpose (condensed)                                                                                                                   |
| -------------------- | ------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/newfile`           | `/new`        | New wiki page  | Search wiki + email + web + YT for existing material, choose the right location, write the page with proper links and no duplication. |
| `/lint`              | `/tidy`       | Tidy a page    | Check DRY, link hygiene, file length, orphan status, stale facts; propose edits (don't auto-apply).                                   |
| `/research`          | `/research`   | Deep research  | Multi-source investigation (wiki + email + web + YT), optionally fan out parallel sub-agents, write a single well-linked page.        |
| `/prune`             | `/prune`      | Prune          | Find obsolete/duplicate/orphan pages in a subtree; propose moves, merges, and deletions for user review.                              |
| `/draft`             | `/draft`      | Draft email    | Gather context (thread, people pages, recent calendar), draft in the user's voice, stop for review before `send_draft`.               |


All authored as plain markdown; all user-editable on disk. The app ships them as a starting point, not a walled garden.

### 7. npm packages to consider

Deliberately minimal — skills are just markdown files.

- `**[gray-matter](https://www.npmjs.com/package/gray-matter)`** — parse YAML frontmatter. Tiny, zero-dep-at-runtime, universal choice for this format. Already battle-tested with `SKILL.md`-style files.
- `**[fuse.js](https://www.npmjs.com/package/fuse.js)`** *(optional)* — fuzzy match for the slash menu. Current `@`-mention filter is plain substring; if we want the same here for v1, skip Fuse and add later.
- `**[chokidar](https://www.npmjs.com/package/chokidar)`** *(optional, dev-mode only)* — hot-reload skills on edit so authors iterate without restarting the server. Nice-to-have.
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

1. Add `skillsDir()` in `[src/server/lib/wikiDir.ts](../../src/server/lib/wikiDir.ts)` (or a new `skillsDir.ts` sibling) returning `<repoDir()>/skills`.
2. Create `assets/user-skills/` at repo root and author the five default skills there (`new`, `tidy`, `research`, `prune`, `draft`), each with `version: 1` in frontmatter.
3. Wire `assets/user-skills/` into the build: copy to `dist/server/assets/user-skills/` during `npm run build`; confirm `tauri:bundle-server` carries it into `desktop/resources/server-bundle/`.
4. Implement `ensureDefaultSkillsSeeded()` (see §5) and call it from `start()` in `[src/server/index.ts](../../src/server/index.ts)`, after `loadDotEnv()`, before HTTP listen. Runs on every boot; idempotent.
5. Add `SkillRegistry` service (discover from `<WIKI_DIR>/skills/`, parse with `gray-matter`, cache; `chokidar`-watch in dev).
6. Wire slash parsing into the `chat.ts` POST handler with per-turn system-prompt injection.
7. Add `/`-menu to `AgentInput.svelte`, mirroring the existing `@`-mention code path.
8. Expose `GET /api/skills` for the menu to hydrate from.
9. Tests: seeder behavior (fresh, rename, delete-and-upgrade, unwritable root), registry parsing, slash parsing, per-turn prompt composition, "unknown skill" handling, idempotency of repeated boots.

## Related

- [OPP-004: Wiki-Aware Agent](./OPP-004-wiki-aware-agent.md) — `/tidy` and `/prune` are natural hosts for the lint/changelog work proposed there.
- [OPP-006: Email-Bootstrap Onboarding](./OPP-006-email-bootstrap-onboarding.md) — onboarding can personalize built-in skills (especially `/draft`).
- [OPP-001: Agent-to-Agent Communication](./OPP-001-agent-to-agent.md) — future: share skills between brains.

## Success criteria

- Typing `/` in chat opens a menu within ~50ms of keystroke; five default skills are listed with `label` + `description`.
- User can edit `<WIKI_DIR>/skills/research/SKILL.md`, re-run `/research`, and see the new behavior take effect with no server restart (dev) / one restart (prod).
- A `SKILL.md` written for Claude Code drops into `<WIKI_DIR>/skills/` and runs with no modification.
- Zero increase in base system-prompt token count when no skill is invoked (skills load per-turn only).

