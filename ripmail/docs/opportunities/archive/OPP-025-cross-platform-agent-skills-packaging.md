# OPP-025: Conform to Agent Skills spec — packaging and platform map

**Status:** Archived — mostly implemented. **Archived:** 2026-04-10. Skill tree + ClawHub listing shipped; CI validation and polish remain in this doc.

**Core artifact shipped** (2026-03-26) — [`skills/ripmail/`](../../skills/ripmail/) has valid YAML frontmatter (`name: ripmail`), body + `references/`, and is linked from [AGENTS.md](../../AGENTS.md) as the publishable `/ripmail` skill. **ClawHub:** the skill is **listed on [ClawHub](https://clawhub.com)** ([clawhub.ai](https://clawhub.ai)) for OpenClaw-style install / discoverability — treat as **done** for registry publishing. **Remaining:** `skills-ref validate` in CI or release checklist, optional manual smoke on Cursor/Claude, README lead-in aligned with AGENTS skill-first ordering.

**Canonical target:** The **end-user** portable skill at [`skills/ripmail/`](../../skills/ripmail/) (in-repo; published **via npm package contents** alongside the CLI) should stay **conformant to the [Agent Skills specification](https://agentskills.io/specification.md)** as the spec and hosts evolve — not an informal markdown file. That means: required directory layout, valid `SKILL.md` YAML frontmatter, naming rules, optional `scripts/` / `references/` / `assets/`, and validation (e.g. [`skills-ref validate`](https://github.com/agentskills/agentskills/tree/main/skills-ref) per the spec). **Out of scope for this OPP:** [`.cursor/skills/`](../../.cursor/skills/) in this repo — internal dev skills (`commit`, `db-dev`, `install-local`, `process-feedback`), not the publishable **`/ripmail`** user skill.

**Problem (reframed):** ripmail is agent-first (CLI + docs), but products disagree on **where** skills live and **what else** they support **beyond** the [Agent Skills](https://agentskills.io/) baseline (extra frontmatter, gating, registries). If we own **one spec-conformant skill tree**, we get a clear bar for CI/docs and **one folder** to copy into Cursor, Claude Code, and OpenClaw — with small, documented deltas where a host’s parser or OpenClaw-specific `metadata` matters.

**Strategic tilt:** Prefer **install CLI + install spec-conformant skill** (instructions that steer subprocess `ripmail`). In-process MCP is **deferred** — see [OPP-039](../OPP-039-mcp-deferred-cli-first.md). Docs and mental model default **skill-first**.

**Example:** We publish **`skills/ripmail/`** in-repo (frontmatter `name: ripmail` → often invoked as **`/ripmail`**): valid `SKILL.md` plus optional `references/`. **End users** copy that folder into **`~/.cursor/skills/ripmail`**, **another project’s** `.cursor/skills/ripmail`, **`~/.claude/skills/ripmail`**, OpenClaw **`<workspace>/skills/ripmail`** or **`~/.openclaw/skills/ripmail`**, etc. — **not** into the ripmail **upstream** repo’s `.cursor/skills/` (reserved for internal dev skills).

---

## Spec conformance (what “done” means for the artifact)

Per [Agent Skills — Specification](https://agentskills.io/specification.md):

| Area | Requirement (summary) |
|------|------------------------|
| **Layout** | Skill is a **directory** with at minimum `SKILL.md`; optional `scripts/`, `references/`, `assets/`. |
| **Frontmatter** | Required: `name` (lowercase, hyphens, matches parent directory, length/charset rules), `description` (what + when, keywords for discovery). Optional: `license`, `compatibility`, `metadata`, experimental `allowed-tools`. |
| **Body** | Markdown instructions after frontmatter; keep main file focused; split detail into `references/` for progressive disclosure. |
| **Validation** | Run **`skills-ref validate ./ripmail`** (or equivalent) in CI or release checklist when we adopt the tooling. |

**ripmail-specific content rules** (on top of the spec): default to subprocess `ripmail` commands. Keep [AGENTS.md](../../AGENTS.md) and [docs/ASK.md](../../docs/ASK.md) as canonical detail; the skill is the **entry playbook**, not a duplicate manual.

---

## Which popular agents work with this spec?

The [Agent Skills](https://agentskills.io/) format is an **open, file-based** contract. **“Works with”** below means: the product **loads `SKILL.md` skills from disk** in a way that aligns with (or is intended to align with) that spec — not “any agent that can run shell,” though many can still **follow** the markdown if given the file.

| Product | Spec-conformant skill folder as **native** skill? | Notes |
|---------|---------------------------------------------------|--------|
| **Claude Code** | **Yes** (intended) | Documents skills in the Agent Skills open format; discovery under `.claude/skills/` and `~/.claude/skills/`. May support **extra** frontmatter beyond the spec — we should stay **spec-minimal** for portability and add Claude-only keys only if needed in a separate optional file or documented extension. See [Claude Code — skills](https://docs.claude.com/en/docs/claude-code/skills). |
| **Cursor** | **Yes** (practical) | Project/personal skill dirs with `SKILL.md` + frontmatter (`.cursor/skills/`, `~/.cursor/skills/`). Align our artifact with the spec so the same folder validates and ships everywhere; verify naming/path rules match Cursor’s docs as they evolve. |
| **OpenClaw** | **Yes** ([docs](https://docs.openclaw.ai/tools/skills)) | OpenClaw documents **[AgentSkills-compatible](https://agentskills.io/)** skill folders: a directory with `SKILL.md` (YAML frontmatter + instructions). Skills load from **bundled** install, **`~/.openclaw/skills`**, **`<workspace>/skills`** (workspace wins on name conflict), plus optional `skills.load.extraDirs` in `~/.openclaw/openclaw.json`. **[ClawHub](https://clawhub.com)** installs into workspace `./skills` by default. **Caveats:** format is “AgentSkills + Pi-compatible” — e.g. parser expects **single-line** frontmatter keys; `metadata` for OpenClaw gating is often a **single-line JSON** blob (`metadata.openclaw.requires.bins`, env, config). Use `{baseDir}` in instructions for the skill folder path. Skills are **filtered at load time** (bins, env, config). |
| **Other IDEs / assistants** | **Varies** | Any environment that discovers markdown skills on disk may align over time; anything **without** skill discovery still benefits from a **validated, stable** folder to paste or bundle. |

**Bottom line:** **Claude Code**, **Cursor**, and **OpenClaw** can all consume **one** spec-validated **`SKILL.md` skill directory**; document **install paths** and **OpenClaw-only** frontmatter/gating only where we need binary presence (`ripmail` on `PATH`) or env hints.

---

## Why skill (+ CLI) is the default packaging story

For **end-user packaging**, a spec-conformant skill + subprocess **`ripmail`** wins on portability: one validated `SKILL.md` tree for Claude Code, Cursor, and OpenClaw; **`ripmail`** on `PATH` for behavior. Richer CLI output and `ripmail ask` reduce round-trips ([OPP-018 archived](OPP-018-reduce-agent-round-trips.md)). Optional in-process MCP is deferred — [OPP-039](../OPP-039-mcp-deferred-cli-first.md).

---

## Platform notes (install locations, publishing)

Details may evolve as vendors ship updates; the **artifact** stays spec-bound.

### Cursor

- **Where:** `.cursor/skills/<skill-name>/` or `~/.cursor/skills/<skill-name>/`.
- **Publishing:** No central store in core docs — distribute **files** (git, tarball, **npm as carrier**) + document copy/symlink targets.

### Claude Code

- **Where:** `.claude/skills/<name>/` or `~/.claude/skills/<name>/`.
- **Publishing:** Same — **files on disk**; optional ecosystem indexes are not our source of truth.

### OpenClaw

Per [OpenClaw — Skills](https://docs.openclaw.ai/tools/skills):

- **Format:** **AgentSkills-compatible** directory + `SKILL.md` (plus optional `scripts/`, etc.), aligned with [agentskills.io](https://agentskills.io/specification.md) layout/intent; OpenClaw adds **Pi-compatible** parsing rules and optional frontmatter (`user-invocable`, `command-dispatch`, …).
- **Where (precedence high → low):** `<workspace>/skills` → `~/.openclaw/skills` → bundled skills; optional lowest-precedence dirs via `skills.load.extraDirs`.
- **Distribution:** [ClawHub](https://clawhub.com) (`clawhub install …`, sync/update flows); plugins can ship skills via `openclaw.plugin.json`.
- **Gating:** `metadata.openclaw` can require bins on `PATH`, env vars, or config paths — useful to **hide** the ripmail skill until `ripmail` is installed (or document install in-body).
---

## Fragmentation at a glance

| Platform | Loads spec `SKILL.md` skill dir? | Typical location | ripmail default story |
|----------|----------------------------------|------------------|---------------------|
| **Cursor** | Yes | `.cursor/skills/` or `~/.cursor/skills/` | Spec skill + CLI |
| **Claude Code** | Yes | `.claude/skills/` or `~/.claude/skills/` | Same folder + CLI |
| **OpenClaw** | Yes (AgentSkills-compatible) | `<workspace>/skills`, `~/.openclaw/skills`, bundled | Same folder + CLI; optional `metadata.openclaw` for `ripmail` bin |

---

## Migration: skill-first defaults (CLI)

**Current state:** **Onboarding** leads with **spec-conformant skill + CLI**; [AGENTS.md](../../AGENTS.md) is the command reference.

**Target state:**

1. **Onboarding** leads with **spec-conformant skill + CLI**.
2. **Release / git** ships the skill directory alongside the CLI; documented paths for **Cursor, Claude Code, and OpenClaw** (`~/.openclaw/skills` / workspace `skills/`), plus **ClawHub** for discoverable install ([clawhub.com](https://clawhub.com) / [clawhub.ai](https://clawhub.ai)) — **published.**
3. **OpenClaw:** document **skill folder** install; call out **gating** (`requires.bins: ["ripmail"]`) if we add OpenClaw-specific `metadata`. ClawHub satisfies the “install from registry” path for many users.

**Phasing (suggested):**

| Phase | What changes |
|-------|----------------|
| **0 — Now** | This doc; **`skills/ripmail/`** layout + frontmatter **done**; `skills-ref validate` still optional. |
| **1** | **`skills/ripmail/`** in repo — **done**. Contributors dogfood via **personal** `~/.cursor/skills/ripmail` — **never** replace this repo’s internal `.cursor/skills/*` dev folders with the user skill. |
| **2** | AGENTS.md: **skill + CLI first** — **done** (Key documents). README: align when convenient. |
| **3** | OpenClaw / **ClawHub listing** — **done** (ripmail skill published for install / discoverability). |
| **4** | If MCP returns: [OPP-039](../OPP-039-mcp-deferred-cli-first.md). |

---

## Proposed directions

1. **Single spec-conformant skill directory**  
   - **Canonical path in-repo:** [`skills/ripmail/`](../../skills/ripmail/) (directory name = frontmatter `name`: `ripmail`).  
   - Validate with **`skills-ref validate`** in CI or pre-publish checklist.  
   - Optional `references/` for deep links to repo docs (progressive disclosure per spec).  
   - **npm:** tarball already includes `skills/ripmail` (no `files` whitelist today); document copy to `~/.cursor/skills/ripmail`, `~/.claude/skills/ripmail`, and OpenClaw **`~/.openclaw/skills/ripmail`** or **`<workspace>/skills/ripmail`**.

2. **OpenClaw / ClawHub**  
   - Same **spec-conformant folder** as other hosts; optionally add **`metadata.openclaw`** (single-line JSON per OpenClaw docs) for `requires.bins: ["ripmail"]` once global/npm install guarantees `PATH`.  
   - **ClawHub:** skill **published** ([clawhub.com](https://clawhub.com) / [clawhub.ai](https://clawhub.ai)) — same `SKILL.md` tree as repo/npm, not a second format.

3. **Optional CLI helper (later)**  
   - e.g. `ripmail skill-path` or `ripmail skill-install --target cursor|claude|openclaw` — opt-in only (no silent writes to home).

4. **DRY**  
   - Short `SKILL.md` body; canonical prose stays in AGENTS.md / docs.

---

## Relationship to prior work

- [OPP-005 (archived)](archive/OPP-005-onboarding-claude-code.md): “Agent-first skill” — this opportunity makes the **Agent Skills spec** the explicit bar; **OpenClaw** also loads AgentSkills-compatible folders ([docs](https://docs.openclaw.ai/tools/skills)), with optional host-specific `metadata`.
- **Internal** Cursor skills (this repo only): [.cursor/skills/](../../.cursor/skills/) — separate from **`skills/ripmail/`** (publishable **`/ripmail`**).

---

## Risks and unknowns

- **Spec vs vendor extensions:** Claude, OpenClaw, etc. may add frontmatter or parsing rules — mitigate with **spec-minimal** core; add **OpenClaw `metadata.openclaw`** only in a way that still validates or lives in a documented optional snippet.  
- **OpenClaw parser constraints:** Single-line keys / single-line JSON `metadata` per [their docs](https://docs.openclaw.ai/tools/skills) — multi-line YAML maps may need adjustment for OpenClaw even if valid elsewhere.  
- **Security:** Emphasize official paths (repo, releases); `.env` hygiene for credentials.  
- **Latency:** Mitigate multi-invocation cost with richer CLI output and `ripmail ask` — see [OPP-018](archive/OPP-018-reduce-agent-round-trips.md).

---

## Test / acceptance criteria

- [x] Opportunity doc + index entry in [OPPORTUNITIES.md](../OPPORTUNITIES.md).  
- [x] Spec-shaped **`skills/ripmail/`** (`SKILL.md` + `references/`) in repository.  
- [ ] Shipped skill directory passes **`skills-ref validate`** (or adopted equivalent) in CI or pre-publish.  
- [ ] Manual smoke: copy into Cursor + Claude Code skill dirs; discovery via description.  
- [x] **ClawHub listing** — ripmail skill published ([clawhub.com](https://clawhub.com) / [clawhub.ai](https://clawhub.ai)) for install / discoverability.  
- [ ] Manual smoke (optional): copy skill into Cursor / Claude Code dirs; OpenClaw via local path or ClawHub install — confirm load + optional bin gating on a target release (version noted if we formalize).  
- [x] AGENTS.md: skill + CLI called out in Key documents (skill-first narrative).  
- [ ] README: lead with skill + CLI (optional polish).

---

## References

- [Agent Skills — Specification](https://agentskills.io/specification.md)  
- [Agent Skills overview](https://agentskills.io/)  
- [skills-ref (validate)](https://github.com/agentskills/agentskills/tree/main/skills-ref)  
- [Claude Code — Extend Claude with skills](https://docs.claude.com/en/docs/claude-code/skills)  
- [OpenClaw — Skills](https://docs.openclaw.ai/tools/skills)  
- [ClawHub](https://clawhub.com)  
- [anthropics/skills (examples)](https://github.com/anthropics/skills)  
- ripmail: [AGENTS.md](../../AGENTS.md)
